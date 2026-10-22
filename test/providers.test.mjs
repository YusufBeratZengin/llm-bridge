import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createProvider as claude } from "../providers/claude-code.mjs";
import { createProvider as codex } from "../providers/codex-cli.mjs";
import { runProcess } from "../src/process.mjs";
import { cliConfig, fakeCli, request, workspace } from "./helpers.mjs";

for (const [name, factory] of [
  ["codex", codex],
  ["claude", claude],
]) {
  test(`${name}: fake executable receives stdin, attachments, model, and no prompt argument`, async (t) => {
    const dir = await workspace(t);
    const script = await fakeCli(dir);
    const provider = factory(cliConfig(script));
    const result = await provider.run(
      request(dir, { model: "test-model", files: [{ name: "input.txt", text: "public code" }] }),
    );
    assert.equal(result.errorKind, null);
    const received = JSON.parse(result.text);
    assert.match(received.input, /Explain this function/);
    assert.match(received.input, /public code/);
    assert.deepEqual(received.args, ["--model", "test-model"]);
    assert.deepEqual(await provider.detect(dir), {
      installed: true,
      auth: "ready",
      errorKind: null,
    });
  });

  for (const [scenario, kind] of [
    ["quota", "quota_exhausted"],
    ["auth-fail", "auth_required"],
    ["empty", "empty_output"],
    ["nonzero", "nonzero_exit"],
    ["timeout", "timeout"],
  ]) {
    test(`${name}: normalizes ${scenario}`, async (t) => {
      const dir = await workspace(t);
      const script = await fakeCli(dir);
      const result = await factory(cliConfig(script, scenario)).run(
        request(dir, { timeoutMs: scenario === "timeout" ? 100 : 3000 }),
      );
      assert.equal(result.errorKind, kind);
      assert.equal(result.text, "");
      assert.notEqual(result.exitCode, 0);
    });
  }
}

test("missing executable and custom regexes are normalized", async (t) => {
  const dir = await workspace(t);
  const script = await fakeCli(dir);
  assert.equal(
    (await codex({ command: join(dir, "absent-agent") }).run(request(dir))).errorKind,
    "not_installed",
  );
  assert.equal((await codex({ command: join(dir, "absent-agent") }).detect(dir)).installed, false);
  const provider = claude({
    ...cliConfig(script, "custom"),
    errorPatterns: { quota_exhausted: ["capacity depleted"] },
  });
  assert.equal((await provider.run(request(dir))).errorKind, "quota_exhausted");
});

test("task permission and gate are enforced even through direct adapters", async (t) => {
  const dir = await workspace(t);
  const script = await fakeCli(dir);
  const provider = codex(cliConfig(script));
  await assert.rejects(provider.run(request(dir, { mode: "task" })), /allow-write/);
  assert.equal(
    (await provider.run(request(dir, { mode: "task", allowWrite: true }))).errorKind,
    null,
  );
  await assert.rejects(provider.run(request(dir, { prompt: "sk-" + "Z".repeat(24) })), {
    name: "GateError",
  });
});

test("default CLI permissions are passed explicitly", async (t) => {
  const dir = await workspace(t);
  const script = await fakeCli(dir);
  const command = { command: process.execPath, args: [script, "success"] };
  for (const mode of ["ask", "review", "task"]) {
    const options = request(dir, { mode, allowWrite: mode === "task" });
    const c = JSON.parse((await codex(command).run(options)).text).args;
    assert.ok(c.includes(mode === "task" ? "workspace-write" : "read-only"));
    const a = JSON.parse((await claude(command).run(options)).text).args;
    assert.equal(a[a.indexOf("--disallowedTools") + 1], "mcp__*");
    assert.equal(a[a.indexOf("--tools") + 1], mode === "task" ? "Read,Edit,Write,Glob,Grep" : "");
  }
});

test("process output limits and timeouts kill the process tree", async (t) => {
  const dir = await workspace(t);
  const script = await fakeCli(dir);
  const marker = join(dir, "escaped.txt");
  const result = await runProcess(process.execPath, [script, "overflow"], {
    cwd: dir,
    timeoutMs: 3000,
    maxBytes: 100,
  });
  assert.equal(result.overflow, true);
  const start = Date.now();
  const timed = await runProcess(process.execPath, [script, "tree", marker], {
    cwd: dir,
    timeoutMs: 300,
  });
  assert.equal(timed.timedOut, true);
  assert.ok(Date.now() - start < 4000);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await assert.rejects(access(marker));
});

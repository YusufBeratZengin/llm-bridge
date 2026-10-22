import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { delegate } from "../src/index.mjs";
import { cliConfig, exec, fakeCli, runCli, workspace } from "./helpers.mjs";

async function configured(t, scenario = "success") {
  const dir = await workspace(t);
  const script = await fakeCli(dir);
  await writeFile(
    join(dir, ".llm-bridge.json"),
    JSON.stringify({ providers: { "codex-cli": cliConfig(script, scenario) } }),
  );
  return dir;
}

test("CLI emits one JSON object or parseable trailer lines, and writes --out", async (t) => {
  const dir = await configured(t);
  const result = await runCli(dir, ["ask", "--json", "Explain public code"]);
  assert.equal(result.code, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.provider, "codex-cli");
  assert.equal(data.errorKind, null);
  assert.equal(result.stdout.trim().split("\n").length, 1);
  const saved = await runCli(dir, ["ask", "--out", "answer.txt", "Explain public code"]);
  assert.equal(saved.code, 0, saved.stderr);
  const lines = saved.stdout.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[0].slice("LLM_BRIDGE_OUTPUT=".length)), join(dir, "answer.txt"));
  assert.equal(lines[1], "LLM_BRIDGE_PROVIDER=codex-cli");
  assert.equal(lines[2], "LLM_BRIDGE_ERROR=");
  assert.match(await readFile(join(dir, "answer.txt"), "utf8"), /Explain public code/);
  const stdin = await runCli(dir, ["ask", "--json", "--prompt", "-"], "Read from stdin");
  assert.match(JSON.parse(stdin.stdout).text, /Read from stdin/);
});

test("CLI gate exits 3 without disclosing values, and has no bypass or key flag", async (t) => {
  const dir = await configured(t);
  const secret = "sk-" + "F".repeat(24);
  const blocked = await runCli(dir, ["ask", "--json", "--prompt", "-"], secret);
  assert.equal(blocked.code, 3);
  assert.equal(JSON.parse(blocked.stdout).errorKind, "privacy_gate");
  assert.ok(!blocked.stdout.includes(secret));
  assert.equal(blocked.stderr, "");
  for (const flag of ["--bypass", "--api-key"]) {
    const result = await runCli(dir, ["ask", "--json", flag, secret]);
    assert.equal(result.code, 1);
    assert.ok(!result.stdout.includes(secret));
    assert.ok(!result.stderr.includes(secret));
  }
  const task = await runCli(dir, ["task", "--json", "Do a task"]);
  assert.equal(task.code, 1);
});

test("CLI providers and doctor return safe machine-readable diagnostics", async (t) => {
  const dir = await configured(t);
  const names = await runCli(dir, ["providers", "--json"]);
  assert.ok(JSON.parse(names.stdout).providers.includes("codex-cli"));
  // Doctor is covered on configured fake CLIs directly to avoid probing real accounts.
  const { createProvider } = await import("../providers/codex-cli.mjs");
  const script = await fakeCli(dir);
  assert.equal((await createProvider(cliConfig(script)).detect(dir)).auth, "ready");
});

test("review includes staged and unstaged diff, gates secrets, and never calls external diff helpers", async (t) => {
  const dir = await workspace(t);
  async function git(args) {
    const result = await exec("git", args, { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    return result;
  }
  await git(["init", "-q"]);
  await writeFile(join(dir, "code.txt"), "baseline\n");
  await git(["add", "code.txt"]);
  await git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-qm",
    "baseline",
  ]);
  await writeFile(join(dir, "code.txt"), "staged\n");
  await git(["add", "code.txt"]);
  await writeFile(join(dir, "code.txt"), "unstaged\n");
  let captured;
  const provider = {
    name: "fake",
    detect: async () => ({ installed: true, auth: "ready", errorKind: null }),
    run: async (r) => {
      captured = r;
      return { text: "review", exitCode: 0, errorKind: null };
    },
  };
  const options = {
    prompt: "Review",
    mode: "review",
    cwd: dir,
    config: {},
    provider: "fake",
    providers: { fake: provider },
    logRoot: dir,
  };
  assert.equal((await delegate(options)).text, "review");
  assert.match(captured.files[0].text, /-baseline/);
  assert.match(captured.files[0].text, /\+unstaged/);
  captured = undefined;
  await writeFile(join(dir, "code.txt"), "sk-" + "Y".repeat(24));
  await assert.rejects(delegate(options), { name: "GateError" });
  assert.equal(captured, undefined);
});

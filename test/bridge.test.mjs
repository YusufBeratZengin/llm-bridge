import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createProvider as claude } from "../providers/claude-code.mjs";
import { createProvider as codex } from "../providers/codex-cli.mjs";
import { delegate } from "../src/index.mjs";
import { request } from "./helpers.mjs";
import { workspace } from "./helpers.mjs";

function stub(name, errorKind, calls) {
  return {
    name,
    detect: async () => ({ installed: true, auth: "ready", errorKind: null }),
    run: async (request) => {
      calls.push({ name, request });
      return { text: errorKind ? "" : "answer", exitCode: errorKind ? 1 : 0, errorKind };
    },
  };
}

test("direct CLI adapters reject gated prompts and unauthorized tasks before process dispatch", async (t) => {
  const dir = await workspace(t);
  for (const factory of [codex, claude]) {
    const provider = factory({ command: "must-not-be-invoked" });
    await assert.rejects(provider.run(request(dir, { prompt: "sk-" + "Q".repeat(24) })), {
      name: "GateError",
    });
    await assert.rejects(provider.run(request(dir, { mode: "task" })), /allow-write/);
  }
});

for (const kind of ["quota_exhausted", "timeout"]) {
  test(`library falls back after ${kind} and records redacted JSONL`, async (t) => {
    const dir = await workspace(t);
    const calls = [];
    const result = await delegate({
      prompt: "A public question",
      cwd: dir,
      config: {},
      provider: "codex",
      fallback: ["ollama"],
      logRoot: dir,
      providers: {
        "codex-cli": stub("codex-cli", kind, calls),
        ollama: stub("ollama", null, calls),
      },
    });
    assert.equal(result.text, "answer");
    assert.equal(result.provider, "ollama");
    assert.deepEqual(
      calls.map((c) => c.name),
      ["codex-cli", "ollama"],
    );
    assert.equal(result.attempts.length, 2);
    const log = await readFile(result.logPath, "utf8");
    assert.ok(!log.includes("A public question"));
    assert.ok(!log.includes("answer"));
    assert.deepEqual(
      log
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).event),
      ["start", "attempt", "attempt"],
    );
  });
}

for (const kind of ["auth_required", "not_installed", "nonzero_exit", "empty_output"]) {
  test(`library does not fall back after ${kind}`, async (t) => {
    const dir = await workspace(t);
    const calls = [];
    const result = await delegate({
      prompt: "Explain",
      cwd: dir,
      config: {},
      provider: "first",
      fallback: ["second"],
      logRoot: dir,
      providers: { first: stub("first", kind, calls), second: stub("second", null, calls) },
    });
    assert.equal(result.errorKind, kind);
    assert.equal(calls.length, 1);
  });
}

test("gate blocks attached secrets and optional PII before custom plugin dispatch", async (t) => {
  const dir = await workspace(t);
  const calls = [];
  const file = join(dir, "input.txt");
  const key = "sk-" + "R".repeat(24);
  await writeFile(file, key);
  const options = {
    prompt: "Explain",
    cwd: dir,
    files: ["input.txt"],
    config: {},
    provider: "custom",
    logRoot: dir,
    providers: { custom: stub("custom", null, calls) },
  };
  await assert.rejects(delegate(options), { name: "GateError" });
  assert.equal(calls.length, 0);
  const logs = (await readdir(dir)).filter((name) => name.startsWith("llm-bridge-"));
  const log = await readFile(join(dir, logs[0], "run.jsonl"), "utf8");
  assert.ok(!log.includes(key));
  await writeFile(file, "sample" + "@example.invalid");
  await assert.rejects(delegate({ ...options, config: { gate: { pii: true } } }), {
    name: "GateError",
  });
  assert.equal(calls.length, 0);
});

test("allowlist is config-only and attachments are snapshotted for providers", async (t) => {
  const dir = await workspace(t);
  const calls = [];
  const key = "sk-" + "T".repeat(24);
  await writeFile(join(dir, "input.txt"), key);
  const result = await delegate({
    prompt: "Explain",
    cwd: dir,
    files: ["input.txt"],
    config: { gate: { allowlist: [key] } },
    provider: "custom",
    logRoot: dir,
    providers: { custom: stub("custom", null, calls) },
  });
  assert.equal(result.errorKind, null);
  assert.equal(calls[0].request.files[0].text, key);
});

test("invalid task permission, mode, timeout, provider, and binary files fail before dispatch", async (t) => {
  const dir = await workspace(t);
  const calls = [];
  const base = {
    prompt: "Explain",
    cwd: dir,
    config: {},
    provider: "custom",
    logRoot: dir,
    providers: { custom: stub("custom", null, calls) },
  };
  await assert.rejects(delegate({ ...base, mode: "task" }), /allow-write/);
  await assert.rejects(delegate({ ...base, timeoutMs: 0 }), /timeoutMs/);
  await assert.rejects(delegate({ ...base, mode: "other" }), /mode/);
  await assert.rejects(delegate({ ...base, provider: "absent" }), /Unknown provider/);
  await writeFile(join(dir, "binary"), Buffer.from([0, 1, 2]));
  await assert.rejects(delegate({ ...base, files: ["binary"] }), /Binary/);
  await writeFile(join(dir, "bad-utf8"), Buffer.from([0xff, 0xfe]));
  await assert.rejects(delegate({ ...base, files: ["bad-utf8"] }));
  assert.equal(calls.length, 0);
  assert.equal((await delegate({ ...base, mode: "task", allowWrite: true })).errorKind, null);
});

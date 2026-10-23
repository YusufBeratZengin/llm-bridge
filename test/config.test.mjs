import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, mergeConfig, validateConfig, validateTimeout } from "../src/config.mjs";
import { resolveCommand } from "../src/process.mjs";
import { createProviders } from "../src/providers.mjs";
import { workspace } from "./helpers.mjs";

test("home and project config merge predictably without mutating global config", async (t) => {
  const dir = await workspace(t);
  const home = join(dir, "home");
  const project = join(dir, "project");
  await mkdir(home);
  await mkdir(project);
  await writeFile(
    join(home, ".llm-bridge.json"),
    JSON.stringify({
      provider: "ollama",
      gate: { pii: true, allowlist: ["public-value"] },
      providers: { ollama: { model: "home-model", baseUrl: "http://127.0.0.1:11434" } },
    }),
  );
  await writeFile(
    join(project, ".llm-bridge.json"),
    JSON.stringify({
      timeoutMs: 4000,
      gate: { allowlist: [] },
      providers: { ollama: { model: "project-model" } },
    }),
  );
  const config = await loadConfig(project, home);
  assert.equal(config.provider, "ollama");
  assert.equal(config.timeoutMs, 4000);
  assert.equal(config.gate.pii, true);
  assert.deepEqual(config.gate.allowlist, []);
  assert.equal(config.providers.ollama.model, "project-model");
  assert.equal(config.providers.ollama.baseUrl, "http://127.0.0.1:11434");
  await writeFile(join(project, ".llm-bridge.json"), "{broken");
  await assert.rejects(loadConfig(project, home), /Cannot load/);
});

test("configuration rejects raw key fields, invalid timeouts, regexes, and bypass switches", () => {
  for (const config of [
    { bypass: true },
    { timeoutMs: 0 },
    { timeoutMs: "100" },
    { gate: { skip: true } },
    { gate: { entropy: false } },
    { gate: { pii: "yes" } },
    { providers: { x: { apiKey: "not-" + "accepted" } } },
    { providers: { x: { apiKeyEnv: "not a variable" } } },
    { providers: { x: { errorPatterns: { timeout: ["[invalid"] } } } },
  ]) {
    assert.throws(() => validateConfig(config));
  }
  assert.throws(
    () => createProviders({ providers: { custom: { command: "custom" } } }),
    /modeArgs/,
  );
  assert.throws(
    () => createProviders({ providers: { codex: { command: "custom", modeArgs: { ask: [] } } } }),
    /canonical/,
  );
  assert.ok(
    createProviders({
      providers: {
        gemini: { command: "gemini", args: ["configured-by-user"], modeArgs: { ask: [] } },
      },
    }).gemini,
  );
});

test("Windows npm shim resolution does not invoke a shell", async (t) => {
  if (process.platform !== "win32") return;
  const dir = await workspace(t);
  const modules = join(dir, "node_modules", "example");
  await mkdir(modules, { recursive: true });
  await writeFile(join(modules, "cli.js"), "");
  await writeFile(
    join(dir, "agent.cmd"),
    '@echo off\n"%_prog%" "%dp0%\\node_modules\\example\\cli.js" %*\n',
  );
  const resolved = await resolveCommand(join(dir, "agent.cmd"), dir);
  assert.equal(resolved.command, process.execPath);
  assert.equal(resolved.prefix[0], join(modules, "cli.js"));
  await writeFile(join(dir, "unsafe.cmd"), "@echo off\necho arbitrary shell script\n");
  assert.equal(await resolveCommand(join(dir, "unsafe.cmd"), dir), null);
});

test("configuration rejects malformed object shapes and executable argument arrays", () => {
  const cases = [
    [null, /must contain objects/],
    [[], /must contain objects/],
    [{ provider: 42 }, /provider must be a string/],
    [{ gate: [] }, /must contain objects/],
    [{ gate: { allowlist: [42] } }, /array of strings/],
    [{ gate: { allowlist: ["public\0value"] } }, /array of strings/],
    [{ providers: [] }, /must contain objects/],
    [{ providers: { "Invalid Name": {} } }, /Invalid provider name/],
    [{ providers: { custom: null } }, /must contain objects/],
    [{ providers: { custom: { command: "" } } }, /nonempty strings/],
    [{ providers: { custom: { model: "public\0model" } } }, /nonempty strings/],
    [{ providers: { custom: { args: "--ask" } } }, /array of strings/],
    [{ providers: { custom: { detectArgs: [1] } } }, /array of strings/],
    [{ providers: { custom: { modeArgs: { execute: [] } } } }, /Unknown configuration field/],
    [
      { providers: { custom: { errorPatterns: { unexpected: ["failure"] } } } },
      /Unknown configuration field/,
    ],
  ];
  for (const [config, expected] of cases) {
    assert.throws(() => validateConfig(config), expected);
  }
});

test("timeouts reject overflow and nonintegers while accepting both timer boundaries", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, -1, 2_147_483_648]) {
    assert.throws(() => validateTimeout(value), /integer between 1 and 2147483647/);
  }
  validateTimeout(1);
  validateTimeout(2_147_483_647);
});

test("project config replaces nested argument maps without mutating home provider settings", () => {
  const home = {
    gate: { pii: true, allowlist: ["public-fixture"] },
    providers: {
      custom: {
        command: "public-agent",
        args: ["home-argument"],
        modeArgs: { ask: ["read"], task: ["write"] },
        errorPatterns: { quota_exhausted: ["capacity"], auth_required: ["login"] },
      },
      ollama: { model: "public-model" },
    },
  };
  const original = structuredClone(home);
  const merged = mergeConfig(home, {
    gate: { allowlist: [] },
    providers: {
      custom: {
        args: [],
        modeArgs: { ask: ["project-read"] },
        errorPatterns: { timeout: ["deadline"] },
      },
    },
  });
  assert.deepEqual(merged.providers.custom, {
    command: "public-agent",
    args: [],
    modeArgs: { ask: ["project-read"] },
    errorPatterns: { timeout: ["deadline"] },
  });
  assert.deepEqual(merged.providers.ollama, { model: "public-model" });
  assert.deepEqual(merged.gate, { pii: true, allowlist: [] });
  assert.deepEqual(home, original);
});

import assert from "node:assert/strict";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createProviders, loadConfig } from "../src/index.mjs";
import { resolveCommand, runProcess } from "../src/process.mjs";
import { project, request, workspace } from "./helpers.mjs";

test("the exact custom-provider documentation config runs against a hypothetical executable", async (t) => {
  const dir = await workspace(t);
  const doc = await readFile(join(project, "docs/custom-providers.md"), "utf8");
  const json = doc.match(/```json\r?\n([\s\S]*?)\r?\n```/)[1];
  await writeFile(join(dir, ".llm-bridge.json"), json);
  const bin = join(dir, "bin");
  const entry = join(bin, "node_modules", "hypothetical", "entry.mjs");
  await mkdir(join(bin, "node_modules", "hypothetical"), { recursive: true });
  const source = `import { readFileSync } from 'node:fs';
    const args = process.argv.slice(2);
    if (args.includes('EXAMPLE_VERSION')) { console.log('fake 1'); process.exit(0); }
    if (args.includes('EXAMPLE_AUTH_STATUS')) { console.log('ready'); process.exit(0); }
    const input = readFileSync(0, 'utf8');
    if (input.includes('simulate quota')) { console.error('capacity depleted'); process.exit(9); }
    if (input.includes('simulate auth')) { console.error('session expired'); process.exit(8); }
    console.log(JSON.stringify({args, input}));`;
  await writeFile(entry, source);
  if (process.platform === "win32") {
    await writeFile(
      join(bin, "hypothetical-agent.cmd"),
      '@echo off\n"%dp0%\\node_modules\\hypothetical\\entry.mjs" %*\n',
    );
  } else {
    const executable = join(bin, "hypothetical-agent");
    await writeFile(executable, `#!/usr/bin/env node\n${source}`);
    await chmod(executable, 0o755);
  }
  const previous = process.env.PATH;
  process.env.PATH = bin + (process.platform === "win32" ? ";" : ":") + previous;
  t.after(() => {
    process.env.PATH = previous;
  });
  const config = await loadConfig(dir, dir);
  // No replacement of the documented command, flags, modes or patterns.
  const provider = createProviders(config).hypothetical;
  assert.equal((await provider.detect(dir)).auth, "ready");
  for (const mode of ["ask", "review", "task"]) {
    const result = await provider.run(request(dir, { mode, allowWrite: mode === "task" }));
    assert.equal(result.errorKind, null);
    const data = JSON.parse(result.text);
    assert.deepEqual(data.args, [
      "EXAMPLE_STDIN",
      mode === "task" ? "EXAMPLE_WORKSPACE_WRITE" : "EXAMPLE_READ_ONLY",
      "EXAMPLE_MODEL",
      "example-model",
    ]);
    assert.match(data.input, /Explain this function/);
  }
  const override = await provider.run(request(dir, { model: "another-model" }));
  assert.equal(JSON.parse(override.text).args.at(-1), "another-model");
  for (const [prompt, kind] of [
    ["simulate quota", "quota_exhausted"],
    ["simulate auth", "auth_required"],
  ])
    assert.equal((await provider.run(request(dir, { prompt }))).errorKind, kind);
});

test(
  "Windows npm .cmd shim resolution uses Node without a shell, including spaces",
  { skip: process.platform !== "win32" },
  async (t) => {
    const dir = await workspace(t);
    const bin = join(dir, "bin with spaces");
    const entry = join(bin, "node_modules", "fake", "entry.js");
    await mkdir(join(bin, "node_modules", "fake"), { recursive: true });
    await writeFile(entry, 'console.log("shim success")');
    const shim = join(bin, "fake.cmd");
    await writeFile(shim, '@echo off\n"%~dp0\\node_modules\\fake\\entry.js" %*\n');
    assert.deepEqual(await resolveCommand(shim, dir), {
      command: process.execPath,
      prefix: [entry],
    });
    const result = await runProcess(shim, [], { cwd: dir, timeoutMs: 3000 });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), "shim success");
    await writeFile(join(bin, "untrusted.cmd"), "@echo off\necho should-not-run");
    assert.equal(await resolveCommand(join(bin, "untrusted.cmd"), dir), null);
  },
);

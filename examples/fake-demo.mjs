// Run from the repository root: node examples/fake-demo.mjs
// Writes only under ignored is/demo; every provider is a local fixture.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const cwd = join(project, "is", "demo");
await mkdir(cwd, { recursive: true });
const script = join(project, "examples", "fake-agent.mjs");
const cli = {
  command: process.execPath,
  args: [script],
  modeArgs: { ask: [], review: [], task: [] },
  detectArgs: [script, "--version"],
  authArgs: [script, "--status"],
};
await writeFile(
  join(cwd, ".llm-bridge.json"),
  JSON.stringify({
    provider: "codex-cli",
    providers: {
      "codex-cli": cli,
      "claude-code": cli,
      ollama: { baseUrl: "http://127.0.0.1:1", model: "fake" },
      "openai-compatible": {
        baseUrl: "https://example.invalid",
        apiKeyEnv: "LLM_BRIDGE_DEMO_ABSENT",
      },
    },
  }),
);

function run(args, input = "", expected = 0) {
  const result = spawnSync(process.execPath, [join(project, "bin/llm-bridge.mjs"), ...args], {
    cwd,
    input,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, LLM_BRIDGE_DEMO_ABSENT: "" },
  });
  if (result.error) throw result.error;
  assert.equal(result.status, expected, result.stderr);
  process.stdout.write(`$ llm-bridge ${args.join(" ")}\n${result.stdout}`);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

run(["providers"]);
run(["doctor", "--json"]);
run(["ask", "--dry-run", "hi"]);
// biome-ignore lint/style/useTemplate: synthetic secret fixtures are built by concatenation.
const blocked = run(["ask", "--json", "--prompt", "-"], "sk-" + "F".repeat(24), 3);
console.log(`exit code: ${blocked.status}`);
const saved = run(["ask", "--out", "answer.txt", "hi"]);
assert.match(saved.stdout, /LLM_BRIDGE_PROVIDER=codex-cli/);
console.log(await readFile(resolve(cwd, "answer.txt"), "utf8"));

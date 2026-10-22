import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const project = fileURLToPath(new URL("../", import.meta.url));
export const scratch = join(project, "is", "tmp");

export async function workspace(t) {
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, "test-"));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return dir;
}

export async function fakeCli(dir) {
  const script = join(dir, "fake-agent.mjs");
  await writeFile(
    script,
    `
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const scenario = process.argv[2];
if (scenario === 'detect') { console.log('fake 1.0'); process.exit(0); }
if (scenario === 'auth') { console.log('authenticated'); process.exit(0); }
if (scenario === 'quota') { console.error('quota exhausted'); process.exit(7); }
if (scenario === 'auth-fail') { console.error('not logged in'); process.exit(8); }
if (scenario === 'custom') { console.error('capacity depleted'); process.exit(9); }
if (scenario === 'nonzero') { console.error('some failure'); process.exit(5); }
if (scenario === 'empty') process.exit(0);
if (scenario === 'tree') {
  spawn(process.execPath, ['-e', 'setTimeout(() => require("node:fs").writeFileSync(process.argv[1], "escaped"), 900)', process.argv[3]], { stdio: 'ignore' });
  setInterval(() => {}, 1000);
} else if (scenario === 'timeout') setInterval(() => {}, 1000);
else if (scenario === 'overflow') process.stdout.write('x'.repeat(10000));
else { const input = readFileSync(0, 'utf8'); console.log(JSON.stringify({input, args: process.argv.slice(3)})); }
`,
  );
  return script;
}

export function cliConfig(script, scenario = "success") {
  return {
    command: process.execPath,
    args: [script, scenario],
    modeArgs: { ask: [], review: [], task: [] },
    detectArgs: [script, "detect"],
    authArgs: [script, "auth"],
  };
}

export async function exec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(options.input ?? "");
  });
}

export function runCli(dir, args, input = "") {
  return exec(process.execPath, [join(project, "bin/llm-bridge.mjs"), ...args], {
    cwd: dir,
    input,
    env: { ...process.env, HOME: dir, USERPROFILE: dir, TMPDIR: dir, TEMP: dir, TMP: dir },
  });
}

export async function server(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${server.address().port}`;
}

export const request = (dir, extras = {}) => ({
  prompt: "Explain this function.",
  cwd: dir,
  mode: "ask",
  timeoutMs: 3000,
  ...extras,
});

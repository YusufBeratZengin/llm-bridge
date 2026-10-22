import assert from "node:assert/strict";
import { access, mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { delegate } from "../src/index.mjs";
import { cliConfig, exec, fakeCli, runCli, server, workspace } from "./helpers.mjs";

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
  const blocked = await runCli(
    dir,
    ["ask", "--provider", "codex", "--json", "--prompt", "-"],
    secret,
  );
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

test("CLI safe input diagnostics never disclose a planted prompt or attachment path", async (t) => {
  const dir = await configured(t);
  const secret = "sk-" + "F".repeat(24);
  for (const [args, message] of [
    [
      ["ask", "--provider", "nosuch", secret],
      "Unknown provider 'nosuch'. Available: codex-cli, claude-code, ollama, openai-compatible",
    ],
    [["task", secret], "--allow-write is required for task mode"],
    [["ask", "--file", secret, secret], "Cannot read attachment (path relative to --cwd)"],
    [["ask", "--file", secret, "  "], "Prompt is empty"],
  ]) {
    for (const json of [false, true]) {
      const result = await runCli(dir, [...args, "--log-dir", "logs", ...(json ? ["--json"] : [])]);
      assert.equal(result.code, 1);
      assert.equal(
        JSON.parse(json ? result.stdout : result.stderr.trim().split("\n").at(-1)).message,
        message,
      );
      assert.ok(!(result.stdout + result.stderr).includes(secret));
    }
  }
  const blocked = await runCli(dir, ["ask", "--json", "--log-dir", "logs", secret]);
  assert.equal(blocked.code, 3);
  assert.ok(!(blocked.stdout + blocked.stderr).includes(secret));
  for (const name of await readdir(join(dir, "logs"))) {
    const log = await readFile(join(dir, "logs", name, "run.jsonl"), "utf8");
    assert.ok(!log.includes(secret));
  }
  const nameLeak = await runCli(dir, ["ask", "--provider", secret, "hi"]);
  assert.ok(!(nameLeak.stdout + nameLeak.stderr).includes(secret));
});

test("dry-run detects but never invokes generation; default notices honor config and CLI", async (t) => {
  const dir = await workspace(t);
  const script = join(dir, "marker-agent.mjs");
  await writeFile(
    script,
    `import { writeFileSync } from 'node:fs';
    if (process.argv[2] === 'detect') console.log('version');
    else if (process.argv[2] === 'auth') console.log('ready');
    else { writeFileSync('called', 'yes'); console.log('unexpected'); }`,
  );
  const config = { providers: { "codex-cli": cliConfig(script) } };
  await writeFile(join(dir, ".llm-bridge.json"), JSON.stringify(config));
  await writeFile(join(dir, "public.txt"), "Public attachment");
  const result = await runCli(dir, [
    "ask",
    "--dry-run",
    "--timeout-ms",
    "800",
    "--file",
    "public.txt",
    "Public prompt",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "using default provider codex-cli\n");
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.provider, "codex-cli");
  assert.equal(plan.mode, "ask");
  assert.equal(plan.timeoutMs, 800);
  assert.deepEqual(plan.attachments, [{ label: "attachment:1", chars: 17 }]);
  assert.equal(plan.detection.installed, true);
  await assert.rejects(access(join(dir, "called")));
  const explicit = await runCli(dir, ["ask", "--provider", "codex", "--dry-run", "hi"]);
  assert.equal(explicit.stderr, "");
  await writeFile(
    join(dir, ".llm-bridge.json"),
    JSON.stringify({ ...config, provider: "codex-cli" }),
  );
  const configured = await runCli(dir, ["ask", "--dry-run", "hi"]);
  assert.equal(configured.stderr, "");
  const blocked = await runCli(dir, ["ask", "--dry-run", "sk-" + "X".repeat(24)]);
  assert.equal(blocked.code, 3);
  await assert.rejects(access(join(dir, "called")));
});

test("paths with spaces and nested --out parents work; write failures are safe", async (t) => {
  const root = await workspace(t);
  const dir = join(root, "working directory");
  await mkdir(dir);
  const script = await fakeCli(dir);
  await writeFile(
    join(dir, ".llm-bridge.json"),
    JSON.stringify({ providers: { "codex-cli": cliConfig(script) } }),
  );
  await writeFile(join(dir, "input file.txt"), "Public attached text");
  const saved = await runCli(root, [
    "ask",
    "--cwd",
    dir,
    "--file",
    "input file.txt",
    "--out",
    "nested directory/answer.txt",
    "hi",
  ]);
  assert.equal(saved.code, 0, saved.stderr);
  assert.match(
    await readFile(join(dir, "nested directory/answer.txt"), "utf8"),
    /Public attached text/,
  );
  await writeFile(join(dir, "blocked"), "a file, not a directory");
  const failure = await runCli(root, ["ask", "--cwd", dir, "--out", "blocked/answer.txt", "hi"]);
  assert.equal(failure.code, 1);
  assert.match(failure.stderr, /Cannot write --out \(path relative to --cwd\)/);
});

for (const scenario of ["quota", "auth-fail"]) {
  test(`CLI codex -> ollama fallback: ${scenario}, aliases once and task warning`, async (t) => {
    const dir = await configured(t, scenario);
    let calls = 0;
    const baseUrl = await server(t, (_req, res) => {
      calls++;
      res.end(JSON.stringify({ response: "local fallback" }));
    });
    const configPath = join(dir, ".llm-bridge.json");
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.providers.ollama = { baseUrl, model: "fake" };
    await writeFile(configPath, JSON.stringify(config));
    const result = await runCli(dir, [
      "task",
      "--allow-write",
      "--json",
      "--fallback",
      "codex,codex-cli,ollama,ollama",
      "hi",
    ]);
    const data = JSON.parse(result.stdout);
    assert.equal(result.code, scenario === "quota" ? 0 : 1, result.stderr);
    assert.equal(calls, scenario === "quota" ? 1 : 0);
    assert.deepEqual(
      data.attempts.map((a) => a.provider),
      scenario === "quota" ? ["codex-cli", "ollama"] : ["codex-cli"],
    );
    assert.equal(data.errorKind, scenario === "quota" ? null : "auth_required");
    assert.equal(result.stderr.includes("partial edits may exist"), scenario === "quota");
  });
}

test("overall timeout caps a CLI attempt and stops fallback dispatch", async (t) => {
  const dir = await configured(t, "timeout");
  let calls = 0;
  const baseUrl = await server(t, (_req, res) => {
    calls++;
    res.end('{"response":"unexpected"}');
  });
  const path = join(dir, ".llm-bridge.json");
  const config = JSON.parse(await readFile(path, "utf8"));
  config.providers.ollama = { baseUrl, model: "fake" };
  await writeFile(path, JSON.stringify(config));
  const started = performance.now();
  const result = await runCli(dir, [
    "ask",
    "--json",
    "--timeout-ms",
    "10000",
    "--total-timeout-ms",
    "200",
    "--fallback",
    "ollama",
    "hi",
  ]);
  assert.equal(result.code, 1);
  const data = JSON.parse(result.stdout);
  assert.equal(data.errorKind, "timeout");
  assert.equal(data.exitCode, 124);
  assert.equal(data.attempts.length, 1);
  assert.equal(calls, 0);
  // Allow bounded Windows taskkill cleanup and test-runner scheduling.
  assert.ok(performance.now() - started < 5000);
});

test("logs override, latest summary, age cleanup and unrelated-file preservation", async (t) => {
  const dir = await configured(t);
  const root = join(dir, "logs");
  const result = await runCli(dir, ["ask", "--json", "--log-dir", root, "Public prompt"]);
  assert.equal(result.code, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  const latest = await runCli(dir, ["logs", "--last", "--log-dir", root]);
  assert.deepEqual(JSON.parse(latest.stdout), {
    path: data.logPath,
    summary: { events: 2, attempts: 1, blocked: false, succeeded: true },
  });
  assert.ok(!latest.stdout.includes("Public prompt"));
  const old = new Date(Date.now() - 8 * 86400000);
  await utimes(data.logPath, old, old);
  const unrelated = join(root, "llm-bridge-unrelated");
  await mkdir(unrelated);
  await writeFile(join(unrelated, "keep.txt"), "keep");
  const clean = await runCli(dir, ["logs", "--clean", "--older-than", "7d", "--log-dir", root]);
  assert.equal(clean.code, 0, clean.stderr);
  assert.deepEqual(JSON.parse(clean.stdout), { removed: 1 });
  assert.equal(await readFile(join(unrelated, "keep.txt"), "utf8"), "keep");
  assert.equal(
    JSON.parse((await runCli(dir, ["logs", "--last", "--log-dir", root])).stdout).path,
    null,
  );
  assert.equal(
    (await runCli(dir, ["logs", "--clean", "--older-than", "0d", "--log-dir", root])).code,
    1,
  );
});

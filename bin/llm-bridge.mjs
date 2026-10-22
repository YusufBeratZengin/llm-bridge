#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { InputError } from "../src/errors.mjs";
import { GateError, createProviders, delegate, doctor, loadConfig } from "../src/index.mjs";
import { cleanLogs, lastLog } from "../src/log.mjs";

const HELP = `llm-bridge 0.1.0 — delegate to locally installed agents or HTTP models

Usage:
  llm-bridge ask|review|task [options] [--] "prompt"
  llm-bridge providers [--cwd directory] [--json]
  llm-bridge doctor [--cwd directory] [--json]
  llm-bridge logs --last [--log-dir directory]
  llm-bridge logs --clean --older-than 7d [--log-dir directory]

Options:
  --provider NAME       Provider (default: config or codex-cli)
  --model NAME          Model override
  --cwd DIRECTORY       Working directory (default: current directory)
  --file PATH           Attach a UTF-8 text file; repeatable
  --prompt TEXT         Prompt instead of positional text; '-' reads stdin
  --timeout-ms N        Per-provider timeout (default: 120000)
  --total-timeout-ms N  Overall chain timeout (default: none)
  --dry-run             Validate, gate and detect; never generate
  --log-dir DIRECTORY  Parent directory for redacted run logs
  --fallback NAMES      Comma-separated providers, tried on quota or timeout
  --allow-write         Required for task mode
  --pii                 Enable PII checks in addition to secret checks
  --out PATH            Save result text; stdout contains only trailer lines
  --json                Emit one JSON object without trailers
  --help                Show this help
  --version             Show version

No API key argument or gate bypass is supported. Use apiKeyEnv in config.
`;

/** @returns {Promise<string>} */
async function stdinText() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += Buffer.byteLength(chunk);
    if (size > 4 * 1024 * 1024) throw new Error("stdin exceeds 4 MiB.");
    chunks.push(Buffer.from(chunk));
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

/** @param {{text: string, provider: string, errorKind: string|null, exitCode: number, [key: string]: unknown}} result @param {boolean} json @param {string} [output] */
function emit(result, json, output) {
  if (json) process.stdout.write(`${JSON.stringify({ ...result, outputPath: output ?? null })}\n`);
  else {
    if (!output && result.text) process.stdout.write(`${result.text}\n`);
    process.stdout.write(
      `LLM_BRIDGE_OUTPUT=${JSON.stringify(output ?? "")}\nLLM_BRIDGE_PROVIDER=${result.provider}\nLLM_BRIDGE_ERROR=${result.errorKind ?? ""}\n`,
    );
  }
  process.exitCode =
    result.exitCode === 0
      ? 0
      : result.exitCode === 3 && result.errorKind === "privacy_gate"
        ? 3
        : 1;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      provider: { type: "string" },
      model: { type: "string" },
      cwd: { type: "string" },
      file: { type: "string", multiple: true },
      prompt: { type: "string" },
      "timeout-ms": { type: "string" },
      "total-timeout-ms": { type: "string" },
      "dry-run": { type: "boolean" },
      "log-dir": { type: "string" },
      last: { type: "boolean" },
      clean: { type: "boolean" },
      "older-than": { type: "string" },
      fallback: { type: "string" },
      "allow-write": { type: "boolean" },
      pii: { type: "boolean" },
      out: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    process.stdout.write("0.1.0\n");
    return;
  }
  const [command, ...words] = positionals;
  if (!command)
    throw new Error("Choose ask, review, task, providers, or doctor. Use --help for usage.");
  const cwd = resolve(values.cwd ?? process.cwd());
  const logRoot = values["log-dir"] ? resolve(cwd, values["log-dir"]) : undefined;
  if (command === "logs") {
    if (words.length || Boolean(values.last) === Boolean(values.clean))
      throw new InputError("Choose logs --last or logs --clean --older-than 7d");
    const report = values.clean
      ? await cleanLogs(logRoot, values["older-than"] ?? "")
      : await lastLog(logRoot);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }
  const config = await loadConfig(cwd);
  if (values.pii) config.gate = { ...config.gate, pii: true };
  if (command === "providers" || command === "doctor") {
    if (words.length || values.prompt || values.out)
      throw new Error("providers and doctor do not accept prompts or --out.");
    if (command === "providers") {
      const names = Object.keys(createProviders(config));
      process.stdout.write(
        values.json ? `${JSON.stringify({ providers: names })}\n` : `${names.join("\n")}\n`,
      );
    } else {
      const checks = await doctor({ cwd, config });
      process.stdout.write(
        values.json
          ? `${JSON.stringify({ providers: checks })}\n`
          : `${checks.map((p) => `${p.name}: ${p.installed ? "available" : "unavailable"}; auth=${p.auth}; error=${p.errorKind ?? "none"}`).join("\n")}\n`,
      );
    }
    return;
  }
  if (!["ask", "review", "task"].includes(command))
    throw new Error("Unknown command. Use --help for usage.");
  if (values.prompt !== undefined && words.length)
    throw new Error("Use either positional prompt text or --prompt.");
  const promptArg = values.prompt ?? words.join(" ");
  const prompt = promptArg === "-" ? await stdinText() : promptArg;
  if (!prompt.trim()) throw new InputError("Prompt is empty");
  if (prompt.includes("\0") || Buffer.byteLength(prompt) > 4 * 1024 * 1024)
    throw new Error("Prompt must be text of at most 4 MiB.");
  const fallback = values.fallback?.split(",");
  if (fallback?.some((name) => !name.trim())) throw new Error("Fallback names must be nonempty.");
  if (values.provider === undefined && config.provider === undefined)
    process.stderr.write("using default provider codex-cli\n");
  const result = await delegate({
    prompt,
    cwd,
    config,
    provider: values.provider,
    model: values.model,
    mode: /** @type {import('../src/types.mjs').Mode} */ (command),
    timeoutMs: values["timeout-ms"] === undefined ? undefined : Number(values["timeout-ms"]),
    totalTimeoutMs:
      values["total-timeout-ms"] === undefined ? undefined : Number(values["total-timeout-ms"]),
    dryRun: values["dry-run"],
    logRoot,
    onWarning: (message) => process.stderr.write(`${message}\n`),
    files: values.file,
    fallback: fallback?.map((name) => name.trim()),
    allowWrite: values["allow-write"],
  });
  if (result.plan) {
    process.stdout.write(`${JSON.stringify(result.plan)}\n`);
    return;
  }
  const output = values.out && !result.errorKind ? resolve(cwd, values.out) : undefined;
  if (output) {
    try {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, result.text, { mode: 0o600 });
    } catch {
      throw new InputError(
        "Cannot write --out (path relative to --cwd); check directory permissions",
      );
    }
  }
  emit(result, values.json ?? false, output);
}

main().catch((error) => {
  const blocked = error instanceof GateError;
  // Never echo parser errors: they can contain an accidentally supplied key.
  const message = blocked
    ? error.message
    : error instanceof InputError
      ? error.message
      : "Request failed. Check command options, configuration, input files, and write permission; use --help.";
  const result = {
    text: "",
    provider: "",
    errorKind: blocked ? "privacy_gate" : "invalid_request",
    exitCode: blocked ? 3 : 1,
    message,
    ...(blocked ? { findings: error.findings } : {}),
  };
  if (!process.argv.includes("--json"))
    process.stderr.write(
      `${JSON.stringify({ message, ...(blocked ? { findings: error.findings } : {}) })}\n`,
    );
  emit(result, process.argv.includes("--json"));
});

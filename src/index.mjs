import { basename, resolve } from "node:path";
import { DEFAULT_TIMEOUT, loadConfig, validateTimeout } from "./config.mjs";
import { InputError, failure } from "./errors.mjs";
import { GateError, scan } from "./gate.mjs";
import { providerInput } from "./input.mjs";
import { createLog } from "./log.mjs";
import { runProcess } from "./process.mjs";
import { canonicalName, createProviders } from "./providers.mjs";

export { GateError, scan } from "./gate.mjs";
export { createProviders } from "./providers.mjs";
export { loadConfig } from "./config.mjs";
/** @import {Config, Provider, Mode, Result, Attachment} from './types.mjs' */
/** @typedef {{provider?: string, prompt: string, cwd?: string, model?: string, mode?: Mode, timeoutMs?: number, totalTimeoutMs?: number, dryRun?: boolean, files?: string[], allowWrite?: boolean, fallback?: string[], config?: Config, providers?: Record<string, Provider>, logRoot?: string, onWarning?: (message: string) => void}} DelegateOptions */

/** Load attached UTF-8 text once; fail closed on binary, invalid encoding, or >4 MiB.
 * @param {string} path
 */
async function readText(path) {
  // Open then stat the same handle to avoid reading unbounded files.
  const { open } = await import("node:fs/promises");
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
      throw new Error("Attachments must be regular text files of at most 4 MiB.");
    const buffer = Buffer.alloc(4 * 1024 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 4 * 1024 * 1024) throw new Error("Attachment exceeds 4 MiB.");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
    if (text.includes("\0")) throw new Error("Binary attachments are not supported.");
    return text;
  } finally {
    await handle.close();
  }
}

/** @param {DelegateOptions} options */
export async function delegate(options) {
  const started = performance.now();
  if (options.totalTimeoutMs !== undefined) validateTimeout(options.totalTimeoutMs);
  const remaining = () =>
    options.totalTimeoutMs === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, options.totalTimeoutMs - (performance.now() - started));
  const cwd = resolve(options.cwd ?? process.cwd());
  const config = options.config ?? (await loadConfig(cwd));
  const registry = options.providers ?? createProviders(config);
  const mode = options.mode ?? "ask";
  const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT;
  validateTimeout(timeoutMs);
  if (mode === "task" && options.allowWrite !== true)
    throw new InputError("--allow-write is required for task mode");
  if (!options.prompt.trim()) throw new InputError("Prompt is empty");
  const names = [
    ...new Set(
      [options.provider ?? config.provider ?? "codex-cli", ...(options.fallback ?? [])].map(
        canonicalName,
      ),
    ),
  ];
  const unknown = names.find((name) => !Object.hasOwn(registry, name));
  if (unknown !== undefined) {
    const label =
      /^[a-z][a-z0-9-]{0,39}$/.test(unknown) && !scan(unknown).length ? ` '${unknown}'` : "";
    throw new InputError(
      `Unknown provider${label}. Available: ${Object.keys(registry)
        .filter((name) => /^[a-z][a-z0-9-]{0,39}$/.test(name) && !scan(name).length)
        .join(", ")}`,
    );
  }
  /** @type {Attachment[]} */
  const files = [];
  for (const path of options.files ?? []) {
    try {
      files.push({ name: basename(path), text: await readText(resolve(cwd, path)) });
    } catch {
      throw new InputError("Cannot read attachment (path relative to --cwd)");
    }
  }
  if (mode === "review") {
    const diff = await runProcess(
      "git",
      ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--", "."],
      { cwd, timeoutMs: Math.max(1, Math.ceil(Math.min(timeoutMs, remaining()))) },
    );
    // An unborn repository needs a committed baseline before review.
    if (diff.exitCode !== 0 || diff.timedOut || diff.overflow || diff.missing)
      throw new Error("Cannot read git diff against HEAD; commit a baseline before review.");
    files.push({ name: "git diff (HEAD, scoped to cwd)", text: diff.stdout });
  }
  const request = {
    prompt: options.prompt,
    cwd,
    model: options.model,
    mode,
    timeoutMs,
    files,
    allowWrite: options.allowWrite,
  };
  const log = await createLog(options.logRoot);
  try {
    // Central enforcement also covers third-party plugin run() implementations.
    providerInput(request, config.gate);
  } catch (error) {
    await log.write({
      event: "blocked",
      promptPreview: "[redacted]",
      findings: error instanceof GateError ? error.findings.length : 0,
    });
    throw error;
  }
  await log.write({
    event: "start",
    mode,
    promptPreview: "[redacted]",
    promptChars: options.prompt.length,
    attachmentCount: files.length,
  });
  if (options.dryRun) {
    return {
      text: "",
      exitCode: 0,
      errorKind: null,
      provider: names[0],
      attempts: [],
      logPath: log.path,
      plan: {
        provider: names[0],
        providers: names,
        mode,
        timeoutMs,
        totalTimeoutMs: options.totalTimeoutMs ?? null,
        // Labels can contain personal data; disclose only ordinal labels and sizes.
        attachments: files.map((file, i) => ({
          label: `attachment:${i + 1}`,
          chars: file.text.length,
        })),
        detection: await registry[names[0]].detect(cwd),
      },
    };
  }
  /** @type {{provider: string, errorKind: Result['errorKind'], exitCode: number}[]} */
  const attempts = [];
  for (const name of names) {
    const budget = remaining();
    let result =
      budget < 1
        ? failure("timeout", 124)
        : await registry[name].run({
            ...request,
            timeoutMs: Math.max(1, Math.ceil(Math.min(timeoutMs, budget))),
          });
    if (remaining() < 1) result = failure("timeout", 124);
    attempts.push({ provider: name, errorKind: result.errorKind, exitCode: result.exitCode });
    await log.write({ event: "attempt", ...attempts.at(-1) });
    if (
      !result.errorKind ||
      !["quota_exhausted", "timeout"].includes(result.errorKind) ||
      name === names.at(-1) ||
      remaining() < 1
    ) {
      return { ...result, provider: name, attempts, logPath: log.path };
    }
    if (mode === "task")
      options.onWarning?.(
        "Fallback after task failure: partial edits may exist; inspect the worktree.",
      );
  }
  throw new Error("No provider selected.");
}

/** @param {{cwd?: string, config?: Config}} [options] */
export async function doctor(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const config = options.config ?? (await loadConfig(cwd));
  const providers = createProviders(config);
  return Promise.all(
    Object.values(providers).map(async (provider) => ({
      name: provider.name,
      ...(await provider.detect(cwd)),
    })),
  );
}

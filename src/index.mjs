import { basename, resolve } from "node:path";
import { DEFAULT_TIMEOUT, loadConfig, validateTimeout } from "./config.mjs";
import { GateError } from "./gate.mjs";
import { providerInput } from "./input.mjs";
import { createLog } from "./log.mjs";
import { runProcess } from "./process.mjs";
import { canonicalName, createProviders } from "./providers.mjs";

export { GateError, scan } from "./gate.mjs";
export { createProviders } from "./providers.mjs";
export { loadConfig } from "./config.mjs";
/** @import {Config, Provider, Mode, Result, Attachment} from './types.mjs' */
/** @typedef {{provider?: string, prompt: string, cwd?: string, model?: string, mode?: Mode, timeoutMs?: number, files?: string[], allowWrite?: boolean, fallback?: string[], config?: Config, providers?: Record<string, Provider>, logRoot?: string}} DelegateOptions */

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
  const cwd = resolve(options.cwd ?? process.cwd());
  const config = options.config ?? (await loadConfig(cwd));
  const registry = options.providers ?? createProviders(config);
  const mode = options.mode ?? "ask";
  const timeoutMs = options.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT;
  validateTimeout(timeoutMs);
  if (mode === "task" && options.allowWrite !== true)
    throw new Error("task mode requires explicit --allow-write (allowWrite: true in the library).");
  const names = [
    ...new Set(
      [options.provider ?? config.provider ?? "codex-cli", ...(options.fallback ?? [])].map(
        canonicalName,
      ),
    ),
  ];
  if (names.some((name) => !Object.hasOwn(registry, name)))
    throw new Error("Unknown provider; run llm-bridge providers.");
  /** @type {Attachment[]} */
  const files = [];
  for (const path of options.files ?? [])
    files.push({ name: basename(path), text: await readText(resolve(cwd, path)) });
  if (mode === "review") {
    const diff = await runProcess(
      "git",
      ["--no-pager", "diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--", "."],
      { cwd, timeoutMs },
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
  /** @type {{provider: string, errorKind: Result['errorKind'], exitCode: number}[]} */
  const attempts = [];
  for (const name of names) {
    const result = await registry[name].run(request);
    attempts.push({ provider: name, errorKind: result.errorKind, exitCode: result.exitCode });
    await log.write({ event: "attempt", ...attempts.at(-1) });
    if (
      !result.errorKind ||
      !["quota_exhausted", "timeout"].includes(result.errorKind) ||
      name === names.at(-1)
    ) {
      return { ...result, provider: name, attempts, logPath: log.path };
    }
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

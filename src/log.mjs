import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { InputError } from "./errors.mjs";

/** Logs deliberately retain no prompt words, paths, arguments, stderr, output, or model names.
 * @param {string} [root]
 */
export async function createLog(root = tmpdir()) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "llm-bridge-"));
  const path = join(directory, "run.jsonl");
  return {
    path,
    /** @param {Record<string, unknown>} event */
    async write(event) {
      await appendFile(path, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`, {
        mode: 0o600,
      });
    },
  };
}

/** Only recognize our own flat, non-symlink log directories.
 * @param {string} root
 */
async function logEntries(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw new InputError("Cannot read --log-dir; check directory permissions");
  });
  const logs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^llm-bridge-[A-Za-z0-9]+$/.test(entry.name)) continue;
    const directory = join(root, entry.name);
    const children = await readdir(directory);
    if (children.length !== 1 || children[0] !== "run.jsonl") continue;
    const path = join(directory, "run.jsonl");
    const stat = await lstat(path);
    if (stat.isFile() && !stat.isSymbolicLink())
      logs.push({ directory, path, mtime: stat.mtimeMs });
  }
  return logs.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
}

/** @param {string} [root] */
export async function lastLog(root = tmpdir()) {
  const latest = (await logEntries(root))[0];
  if (!latest) return { path: null, summary: null };
  const events = (await readFile(latest.path, "utf8")).trim().split("\n");
  let attempts = 0;
  let blocked = false;
  let succeeded = false;
  for (const line of events) {
    try {
      const event = JSON.parse(line);
      if (event.event === "attempt") {
        attempts++;
        succeeded = event.errorKind === null && event.exitCode === 0;
      }
      if (event.event === "blocked") blocked = true;
    } catch {
      /* Ignore incomplete lines; never echo raw log content. */
    }
  }
  return { path: latest.path, summary: { events: events.length, attempts, blocked, succeeded } };
}

/** @param {string} [root] @param {string} [age] */
export async function cleanLogs(root = tmpdir(), age = "") {
  if (!/^[1-9]\d*d$/.test(age) || !Number.isSafeInteger(Number(age.slice(0, -1))))
    throw new InputError("--older-than must be a positive number of days, for example 7d");
  const logRoot = resolve(root);
  const cutoff = Date.now() - Number(age.slice(0, -1)) * 86_400_000;
  let removed = 0;
  for (const log of await logEntries(logRoot)) {
    if (log.mtime >= cutoff) continue;
    const child = relative(logRoot, resolve(log.directory));
    if (!child || child.startsWith("..") || isAbsolute(child))
      throw new InputError("Cannot clean logs outside --log-dir");
    await rm(log.directory, { recursive: true });
    removed++;
  }
  return { removed };
}

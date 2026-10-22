import assert from "node:assert/strict";
import { access, mkdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { cleanLogs, createLog, lastLog } from "../src/log.mjs";
import { workspace } from "./helpers.mjs";

test("log summaries whitelist fields and cleanup only removes expired owned logs", async (t) => {
  const root = await workspace(t);
  assert.deepEqual(await lastLog(root), { path: null, summary: null });
  const log = await createLog(join(root, "new root"));
  const secret = "sk-" + "X".repeat(24);
  // Even manually corrupted logs cannot inject raw values into the summary.
  await log.write({ event: "start", injected: secret });
  await log.write({ event: "attempt", errorKind: null, exitCode: 0, text: secret });
  const latest = await lastLog(join(root, "new root"));
  assert.deepEqual(latest.summary, { events: 2, attempts: 1, blocked: false, succeeded: true });
  assert.ok(!JSON.stringify(latest).includes(secret));
  assert.deepEqual(await cleanLogs(join(root, "new root"), "7d"), { removed: 0 });
  const old = new Date(Date.now() - 8 * 86400000);
  await utimes(log.path, old, old);
  const unrelated = join(root, "new root", "llm-bridge-unrelated");
  await mkdir(unrelated);
  await writeFile(join(unrelated, "keep.txt"), "keep");
  assert.deepEqual(await cleanLogs(join(root, "new root"), "7d"), { removed: 1 });
  await assert.rejects(access(log.path));
  assert.equal(await readFile(join(unrelated, "keep.txt"), "utf8"), "keep");
  for (const age of ["", "0d", "-1d", "1h", "Infinityd", "999999999999999999999d"])
    await assert.rejects(cleanLogs(root, age), /--older-than/);
});

test(
  "log discovery never follows symlink directories",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await workspace(t);
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "run.jsonl"), '{"event":"blocked"}\n');
    const logs = join(root, "logs");
    await mkdir(logs);
    await symlink(outside, join(logs, "llm-bridge-linked"), "dir");
    assert.deepEqual(await lastLog(logs), { path: null, summary: null });
    assert.deepEqual(await cleanLogs(logs, "1d"), { removed: 0 });
    await access(join(outside, "run.jsonl"));
  },
);

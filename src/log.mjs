import { appendFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Logs deliberately retain no prompt words, paths, arguments, stderr, output, or model names.
 * @param {string} [root]
 */
export async function createLog(root = tmpdir()) {
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

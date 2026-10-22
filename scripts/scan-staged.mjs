import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { scan } from "../src/gate.mjs";

// Exact public package checksums, reviewed independently of runtime gate config.
const { allowlist } = JSON.parse(
  await readFile(new URL("./scan-allowlist.json", import.meta.url), "utf8"),
);
if (!Array.isArray(allowlist) || allowlist.some((value) => typeof value !== "string"))
  throw new Error("Invalid staged-scan allowlist.");

const paths = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
let blocked = false;
for (const path of paths) {
  const content = execFileSync("git", ["show", `:${path}`], { maxBuffer: 32 * 1024 * 1024 });
  if (content.includes(0)) continue;
  const findings = scan(content.toString("utf8"), { allowlist }, "staged file");
  if (findings.length) {
    blocked = true;
    console.error(`${JSON.stringify({ file: path, findings })}`);
  }
}
if (blocked) process.exitCode = 3;
else console.log(`Secret scan passed (${paths.length} staged files).`);

#!/usr/bin/env node
// Public, deterministic fixture. This executable never contacts a model.
import { readFileSync } from "node:fs";

if (process.argv.includes("--version")) console.log("fake-agent 1.0");
else if (process.argv.includes("--status")) console.log("authenticated");
else {
  readFileSync(0, "utf8");
  console.log("Demo answer from a fake executable.");
}

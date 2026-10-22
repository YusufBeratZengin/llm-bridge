import { createCliProvider } from "../src/cli-provider.mjs";

/** @param {import('../src/types.mjs').ProviderConfig} [config] @param {import('../src/types.mjs').GateConfig} [gate] */
export function createProvider(config = {}, gate = {}) {
  return createCliProvider(
    "claude-code",
    {
      command: "claude",
      args: ["-p", "--output-format", "text", "--no-session-persistence"],
      modeArgs: {
        ask: ["--tools", "", "--disallowedTools", "mcp__*"],
        review: ["--tools", "", "--disallowedTools", "mcp__*"],
        task: [
          "--permission-mode",
          "acceptEdits",
          "--tools",
          "Read,Edit,Write,Glob,Grep",
          "--disallowedTools",
          "mcp__*",
        ],
      },
      detectArgs: ["--version"],
      authArgs: ["auth", "status"],
    },
    config,
    gate,
  );
}
export default createProvider();

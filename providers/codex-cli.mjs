import { createCliProvider } from "../src/cli-provider.mjs";

/** @param {import('../src/types.mjs').ProviderConfig} [config] @param {import('../src/types.mjs').GateConfig} [gate] */
export function createProvider(config = {}, gate = {}) {
  return createCliProvider(
    "codex-cli",
    {
      command: "codex",
      args: ["exec", "--ephemeral", "--color", "never"],
      modeArgs: {
        ask: ["--sandbox", "read-only", "-"],
        review: ["--sandbox", "read-only", "-"],
        task: ["--sandbox", "workspace-write", "-"],
      },
      detectArgs: ["--version"],
      authArgs: ["login", "status"],
    },
    config,
    gate,
  );
}
export default createProvider();

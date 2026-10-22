import { createProvider as claude } from "../providers/claude-code.mjs";
import { createProvider as codex } from "../providers/codex-cli.mjs";
import { createProvider as ollama } from "../providers/ollama.mjs";
import { createProvider as compatible } from "../providers/openai-compatible.mjs";
import { createCliProvider } from "./cli-provider.mjs";
import { validateConfig } from "./config.mjs";

export const ALIASES = { codex: "codex-cli", claude: "claude-code" };
/** @param {string} name */
export function canonicalName(name) {
  return /** @type {Record<string,string>} */ (ALIASES)[name] ?? name;
}
/** @param {import('./types.mjs').Config} [config] @returns {Record<string, import('./types.mjs').Provider>} */
export function createProviders(config = {}) {
  validateConfig(config);
  const settings = config.providers ?? {};
  const providers = {
    "codex-cli": codex(settings["codex-cli"], config.gate),
    "claude-code": claude(settings["claude-code"], config.gate),
    ollama: ollama(settings.ollama, config.gate),
    "openai-compatible": compatible(settings["openai-compatible"], config.gate),
  };
  for (const [name, value] of Object.entries(settings)) {
    if (Object.hasOwn(providers, name)) continue;
    if (canonicalName(name) !== name)
      throw new Error("Configure providers by canonical name: codex-cli or claude-code.");
    if (!value.command || !value.modeArgs)
      throw new Error("Custom providers require command and explicit modeArgs.");
    /** @type {Record<string, import('./types.mjs').Provider>} */ (providers)[name] =
      createCliProvider(name, {}, value, config.gate);
  }
  return providers;
}

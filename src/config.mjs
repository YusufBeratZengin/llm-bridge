import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** @import {Config, ProviderConfig} from './types.mjs' */
export const DEFAULT_TIMEOUT = 120_000;
export const MODES = ["ask", "review", "task"];
export const ERROR_KINDS = [
  "quota_exhausted",
  "auth_required",
  "timeout",
  "not_installed",
  "empty_output",
  "nonzero_exit",
];

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Configuration must contain objects.");
  return /** @type {Record<string, unknown>} */ (value);
}
/** @param {Record<string, unknown>} value @param {string[]} keys */
function known(value, keys) {
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error(
      "Unknown configuration field; API keys must be supplied through environment variables only.",
    );
}
/** @param {unknown} value */
function strings(value) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.includes("\0"))
  )
    throw new Error("Expected an array of strings.");
}
/** @param {number} value */
export function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
    throw new Error("timeoutMs must be an integer between 1 and 2147483647.");
}
/** @param {unknown} input @returns {Config} */
export function validateConfig(input) {
  const config = object(input);
  known(config, ["provider", "timeoutMs", "gate", "providers"]);
  if (config.provider !== undefined && typeof config.provider !== "string")
    throw new Error("provider must be a string.");
  if (config.timeoutMs !== undefined) validateTimeout(/** @type {number} */ (config.timeoutMs));
  if (config.gate !== undefined) {
    const gate = object(config.gate);
    known(gate, ["pii", "allowlist"]);
    for (const key of ["pii"])
      if (gate[key] !== undefined && typeof gate[key] !== "boolean")
        throw new Error("Gate switches must be booleans.");
    if (gate.allowlist !== undefined) strings(gate.allowlist);
  }
  if (config.providers !== undefined) {
    for (const [name, inputProvider] of Object.entries(object(config.providers))) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Invalid provider name.");
      const p = object(inputProvider);
      known(p, [
        "command",
        "args",
        "modeArgs",
        "modelArgs",
        "detectArgs",
        "authArgs",
        "baseUrl",
        "apiKeyEnv",
        "model",
        "errorPatterns",
      ]);
      for (const field of ["command", "baseUrl", "apiKeyEnv", "model"]) {
        if (
          p[field] !== undefined &&
          (typeof p[field] !== "string" || !p[field] || p[field].includes("\0"))
        )
          throw new Error("Provider string fields must be nonempty strings.");
      }
      if (p.apiKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(p.apiKeyEnv)))
        throw new Error("apiKeyEnv must be an environment variable name, never a key.");
      for (const field of ["args", "modelArgs", "detectArgs", "authArgs"])
        if (p[field] !== undefined) strings(p[field]);
      for (const field of ["modeArgs", "errorPatterns"]) {
        if (p[field] === undefined) continue;
        const entries = object(p[field]);
        known(entries, field === "modeArgs" ? MODES : ERROR_KINDS);
        for (const value of Object.values(entries)) {
          strings(value);
          if (field === "errorPatterns")
            for (const expression of /** @type {string[]} */ (value)) new RegExp(expression, "i");
        }
      }
    }
  }
  return /** @type {Config} */ (config);
}

/** Project fields override home fields; providers merge one level deeper. Arrays replace.
 * @param {Config} home @param {Config} project @returns {Config}
 */
export function mergeConfig(home, project) {
  const providers = { ...home.providers };
  for (const [name, value] of Object.entries(project.providers ?? {}))
    providers[name] = { ...providers[name], ...value };
  return validateConfig({
    ...home,
    ...project,
    gate: { ...home.gate, ...project.gate },
    providers,
  });
}

/** @param {string} path @returns {Promise<Config>} */
async function readConfig(path) {
  try {
    return validateConfig(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return {};
    throw new Error("Cannot load .llm-bridge.json: invalid JSON or configuration.");
  }
}
/** @param {string} [cwd] @param {string} [home] */
export async function loadConfig(cwd = process.cwd(), home = homedir()) {
  const [global, project] = await Promise.all([
    readConfig(join(home, ".llm-bridge.json")),
    readConfig(join(cwd, ".llm-bridge.json")),
  ]);
  return mergeConfig(global, project);
}

import { createHttpProvider } from "../src/http-provider.mjs";

/** @param {import('../src/types.mjs').ProviderConfig} [config] @param {import('../src/types.mjs').GateConfig} [gate] */
export function createProvider(config = {}, gate = {}) {
  return createHttpProvider("openai-compatible", false, config, gate);
}
export default createProvider();

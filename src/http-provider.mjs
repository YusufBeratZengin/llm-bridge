import { classifyError, failure } from "./errors.mjs";
import { providerInput } from "./input.mjs";

/** @import {Provider, ProviderConfig, GateConfig, Result} from './types.mjs' */
/** @param {ProviderConfig} settings @param {boolean} ollama */
function endpoint(settings, ollama) {
  if (!settings.baseUrl) throw new Error("Configure the HTTP provider baseUrl first.");
  const url = new URL(settings.baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local))
  )
    throw new Error(
      "baseUrl requires HTTPS (HTTP is allowed on loopback only), without credentials, query, or fragment.",
    );
  if (ollama && !local)
    throw new Error(
      "The Ollama adapter is restricted to loopback; use openai-compatible for remote services.",
    );
  return url.href.replace(/\/$/, "");
}

/** @param {Response} response */
async function readBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error("Response exceeds the size limit.");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** @param {string} name @param {boolean} ollama @param {ProviderConfig} [config] @param {GateConfig} [gate] @returns {Provider} */
export function createHttpProvider(name, ollama, config = {}, gate = {}) {
  const settings = {
    ...(ollama ? { baseUrl: "http://127.0.0.1:11434" } : { apiKeyEnv: "OPENAI_API_KEY" }),
    ...config,
  };
  /** @returns {Record<string, string>} */
  function headers() {
    const key = settings.apiKeyEnv ? process.env[settings.apiKeyEnv] : undefined;
    return {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    };
  }
  return {
    name,
    async detect() {
      if (!settings.baseUrl)
        return { installed: false, auth: "unknown", errorKind: "not_installed" };
      if (settings.apiKeyEnv && !process.env[settings.apiKeyEnv])
        return { installed: true, auth: "required", errorKind: "auth_required" };
      try {
        const url = endpoint(settings, ollama);
        const response = await fetch(url + (ollama ? "/api/tags" : "/models"), {
          headers: headers(),
          signal: AbortSignal.timeout(5000),
          redirect: "error",
        });
        await response.body?.cancel();
        const kind = response.ok
          ? null
          : classifyError(response.status, "", settings.errorPatterns);
        return {
          installed: true,
          auth: kind === "auth_required" ? "required" : kind ? "unknown" : "ready",
          errorKind: kind,
        };
      } catch {
        return { installed: false, auth: "unknown", errorKind: "nonzero_exit" };
      }
    },
    async run(request) {
      const input = providerInput(request, gate);
      const url = endpoint(settings, ollama);
      if (settings.apiKeyEnv && !process.env[settings.apiKeyEnv]) return failure("auth_required");
      const model = request.model ?? settings.model;
      if (!model) throw new Error("HTTP providers require a model in config or --model.");
      const signal = AbortSignal.timeout(request.timeoutMs);
      try {
        const response = await fetch(url + (ollama ? "/api/generate" : "/chat/completions"), {
          method: "POST",
          headers: headers(),
          redirect: "error",
          signal,
          body: JSON.stringify(
            ollama
              ? { model, prompt: input, stream: false }
              : { model, messages: [{ role: "user", content: input }], stream: false },
          ),
        });
        const body = await readBody(response);
        if (!response.ok)
          return failure(classifyError(response.status, body, settings.errorPatterns));
        const data = JSON.parse(body);
        if (data.error)
          return failure(
            classifyError(
              1,
              typeof data.error === "string" ? data.error : JSON.stringify(data.error),
              settings.errorPatterns,
            ),
          );
        const text = ollama ? data.response : data.choices?.[0]?.message?.content;
        if (text == null || text === "") return failure("empty_output");
        if (typeof text !== "string") return failure("nonzero_exit");
        if (!text.trim()) return failure("empty_output");
        const rawUsage = ollama
          ? { prompt_tokens: data.prompt_eval_count, completion_tokens: data.eval_count }
          : data.usage;
        const usage = Object.fromEntries(
          Object.entries(rawUsage ?? {}).filter(
            ([key, value]) =>
              /^[a-z_]+$/.test(key) && typeof value === "number" && Number.isFinite(value),
          ),
        );
        return { text: text.trim(), usage, exitCode: 0, errorKind: null };
      } catch {
        return failure(signal.aborted ? "timeout" : "nonzero_exit", signal.aborted ? 124 : 1);
      }
    },
  };
}

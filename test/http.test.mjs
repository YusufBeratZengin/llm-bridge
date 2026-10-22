import assert from "node:assert/strict";
import test from "node:test";
import { createProvider as ollama } from "../providers/ollama.mjs";
import { createProvider as compatible } from "../providers/openai-compatible.mjs";
import { request, server, workspace } from "./helpers.mjs";

for (const [name, factory] of [
  ["openai-compatible", compatible],
  ["ollama", ollama],
]) {
  test(`${name}: local HTTP request, response, usage, and doctor`, async (t) => {
    const dir = await workspace(t);
    const received = [];
    const baseUrl = await server(t, async (req, res) => {
      if (req.method === "GET") {
        res.end("{}");
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      received.push({ url: req.url, body: JSON.parse(body), auth: req.headers.authorization });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          name === "ollama"
            ? { response: "local answer", prompt_eval_count: 3, eval_count: 2 }
            : {
                choices: [{ message: { content: "local answer" } }],
                usage: { prompt_tokens: 3, completion_tokens: 2 },
              },
        ),
      );
    });
    const provider = factory({ baseUrl, model: "test-model" });
    if (name === "openai-compatible") {
      provider.run = compatible({
        baseUrl,
        model: "test-model",
        apiKeyEnv: "LLM_BRIDGE_TEST_TOKEN",
      }).run;
      const before = process.env.LLM_BRIDGE_TEST_TOKEN;
      process.env.LLM_BRIDGE_TEST_TOKEN = "synthetic" + "-test-only";
      t.after(() => {
        // biome-ignore lint/performance/noDelete: assigning undefined creates a literal environment value.
        if (before === undefined) delete process.env.LLM_BRIDGE_TEST_TOKEN;
        else process.env.LLM_BRIDGE_TEST_TOKEN = before;
      });
    }
    const result = await provider.run(request(dir));
    assert.equal(result.text, "local answer");
    assert.equal(result.errorKind, null);
    assert.equal(result.usage.prompt_tokens, 3);
    assert.equal(received[0].body.stream, false);
    assert.equal(received[0].body.model, "test-model");
    assert.equal(received[0].url, name === "ollama" ? "/api/generate" : "/chat/completions");
    const input =
      name === "ollama" ? received[0].body.prompt : received[0].body.messages[0].content;
    assert.match(input, /Explain this function/);
    if (name === "openai-compatible") assert.equal(received[0].auth, "Bearer synthetic-test-only");
    assert.equal((await factory({ baseUrl, apiKeyEnv: undefined }).detect()).auth, "ready");
  });
}

for (const [status, body, kind] of [
  [429, "quota", "quota_exhausted"],
  [401, "login", "auth_required"],
  [500, "bad", "nonzero_exit"],
  [200, "{}", "empty_output"],
  [200, "invalid-json", "nonzero_exit"],
  [200, '{"error":"quota exhausted"}', "quota_exhausted"],
]) {
  test(`HTTP normalizes ${status}/${kind}`, async (t) => {
    const dir = await workspace(t);
    const baseUrl = await server(t, (_req, res) => {
      res.statusCode = status;
      res.end(body);
    });
    assert.equal((await ollama({ baseUrl, model: "fake" }).run(request(dir))).errorKind, kind);
  });
}

test("HTTP timeout includes a stalled body, and gate prevents any request", async (t) => {
  const dir = await workspace(t);
  let calls = 0;
  const baseUrl = await server(t, (_req, res) => {
    calls++;
    res.writeHead(200);
    res.write("{");
  });
  const provider = ollama({ baseUrl, model: "fake" });
  assert.equal((await provider.run(request(dir, { timeoutMs: 100 }))).errorKind, "timeout");
  const previous = calls;
  await assert.rejects(provider.run(request(dir, { prompt: "sk-" + "X".repeat(24) })), {
    name: "GateError",
  });
  assert.equal(calls, previous);
});

test("HTTP missing auth, unsafe URLs, redirects, and absent model fail safely", async (t) => {
  const dir = await workspace(t);
  let calls = 0;
  const baseUrl = await server(t, (_req, res) => {
    calls++;
    res.writeHead(302, { Location: "/elsewhere" });
    res.end();
  });
  const p = compatible({ baseUrl, model: "fake", apiKeyEnv: "LLM_BRIDGE_ABSENT_TEST_ENV" });
  assert.equal((await p.run(request(dir))).errorKind, "auth_required");
  assert.equal(calls, 0);
  assert.equal((await p.detect()).auth, "required");
  assert.equal(
    (await ollama({ baseUrl, model: "fake" }).run(request(dir))).errorKind,
    "nonzero_exit",
  );
  assert.equal(calls, 1);
  await assert.rejects(
    ollama({ baseUrl: "http://example.invalid", model: "fake" }).run(request(dir)),
    /HTTPS/,
  );
  await assert.rejects(
    ollama({ baseUrl: "https://example.invalid", model: "fake" }).run(request(dir)),
    /loopback/,
  );
  await assert.rejects(ollama({ baseUrl }).run(request(dir)), /model/);
});

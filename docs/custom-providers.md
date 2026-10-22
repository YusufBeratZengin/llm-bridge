# Custom stdin providers

Gemini, Antigravity-style, and other CLIs can use the configurable stdin adapter. This worked example describes a **hypothetical** executable named `hypothetical-agent`. Every `EXAMPLE_*` argument below is a **placeholder**, not a verified flag for any real CLI. Replace the executable and every flag using your installed CLI's documentation. Never add permission-bypass flags.

Save this exact JSON as `.llm-bridge.json` in an isolated working directory:

```json
{
  "provider": "hypothetical",
  "providers": {
    "hypothetical": {
      "command": "hypothetical-agent",
      "args": ["EXAMPLE_STDIN"],
      "modeArgs": {
        "ask": ["EXAMPLE_READ_ONLY"],
        "review": ["EXAMPLE_READ_ONLY"],
        "task": ["EXAMPLE_WORKSPACE_WRITE"]
      },
      "model": "example-model",
      "modelArgs": ["EXAMPLE_MODEL", "{model}"],
      "detectArgs": ["EXAMPLE_VERSION"],
      "authArgs": ["EXAMPLE_AUTH_STATUS"],
      "errorPatterns": {
        "quota_exhausted": ["capacity depleted"],
        "auth_required": ["session expired"]
      }
    }
  }
}
```

The adapter sends the gated prompt and attachment snapshots on stdin. It passes `args`, then the selected `modeArgs`, then `modelArgs`. Ask and review must enforce read-only behavior in the underlying CLI; task still requires `--allow-write`. Review also requires a committed git baseline. A model override replaces `{model}` only in `modelArgs`.

Before generation, inspect the plan:

```sh
llm-bridge ask --dry-run "Explain public code"
```

Dry-run calls only the configured detection and auth status commands. Those commands must be safe status checks. It never calls the generation invocation. Error patterns apply only to failed invocations and replace defaults for that kind. Quota and timeout can trigger explicit fallback; expired authentication cannot.

`test/custom-provider.test.mjs` extracts this exact JSON from this document, loads it through `loadConfig()`, resolves a fake executable, and verifies all modes, model substitution, stdin, detection, and both error patterns. The fake executable implements these placeholder flags only for testing; this is not proof of compatibility with a real third-party CLI.

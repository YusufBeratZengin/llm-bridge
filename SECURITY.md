# Security policy

## Supported versions

Security fixes target the latest 0.1.x release. No other release line is currently supported.

## Reporting a vulnerability

Do not put real keys, personal information, private prompts, or exploit payloads targeting real services in public issues. If the hosting repository provides private vulnerability reporting, use its Security tab. Otherwise open a minimal public issue requesting a private reporting channel without disclosing the vulnerability details. No private contact address is assumed before the repository is published.

Provide the affected version, operating system, provider version, expected boundary, and a minimal reproduction using synthetic data. Do not test against third-party systems without authorization. There is no guaranteed response time or bug bounty.

## Threat model

The pre-send gate covers explicit prompts, attached UTF-8 text, labels, and generated review diffs. It is heuristic and can miss encoded or unfamiliar secrets, names, and addresses. PII scanning is opt-in. High-entropy hexadecimal digests of length 40 or 64 are excluded. Exact allowlists can create blind spots. Never allowlist actual credentials or private data.

Agent CLIs can independently load repository context, settings, hooks, plugins, and MCP servers. Such context and later file reads are outside the gate. A CLI's read-only flag does not prevent data transmission. Config files, executable templates, and library plugins are trusted executable configuration. Inspect project configuration before execution and isolate sensitive repositories. HTTP endpoints do not receive tools from this library. Local Ollama is not proof that its selected model stays local.

Authentication values are read from named environment variables and sent only in HTTP authorization headers. The bridge rejects key command arguments and raw key configuration fields. Inherited CLI environment and provider-managed credentials remain under the provider's control. Remote HTTP endpoints require TLS; redirects and URL credentials/query strings are rejected. A loopback service and the host itself must still be trusted.

Logs omit raw prompt text, output, file paths, model names, command arguments, and diagnostics. Gate reports contain positions only. Model output and explicitly requested output files can still contain sensitive material; review them before sharing. POSIX file modes are best effort on Windows, where ACLs apply.

Task mode requires explicit write permission but does not create a universal filesystem sandbox or rollback changes. Custom CLI templates can weaken mode restrictions. Timeout cleanup cannot reliably stop deliberately detached descendants or remotely accepted work. Fallback can repeat a partially completed task. Review the working tree before rerunning write operations.

The staged-file scanner and CI are additional checks, not evidence that arbitrary data is safe to disclose. Never bypass a privacy gate to recover from quota or authentication failures.

/**
 * @typedef {'ask'|'review'|'task'} Mode
 * @typedef {'quota_exhausted'|'auth_required'|'timeout'|'not_installed'|'empty_output'|'nonzero_exit'} ErrorKind
 * @typedef {{text: string, usage?: Record<string, unknown>, exitCode: number, errorKind: ErrorKind|null}} Result
 * @typedef {{name: string, text: string}} Attachment
 * @typedef {{kind: string, source: string, line: number, column: number}} Finding
 * @typedef {{pii?: boolean, allowlist?: string[]}} GateConfig
 * @typedef {{prompt: string, cwd: string, model?: string, mode: Mode, timeoutMs: number, files?: Attachment[], allowWrite?: boolean}} RunRequest
 * @typedef {{installed: boolean, auth: 'ready'|'required'|'unknown', errorKind: ErrorKind|null}} Detection
 * @typedef {{command?: string, args?: string[], modeArgs?: Partial<Record<Mode, string[]>>, modelArgs?: string[], detectArgs?: string[], authArgs?: string[], baseUrl?: string, apiKeyEnv?: string, model?: string, errorPatterns?: Partial<Record<ErrorKind, string[]>>}} ProviderConfig
 * @typedef {{provider?: string, timeoutMs?: number, gate?: GateConfig, providers?: Record<string, ProviderConfig>}} Config
 * @typedef {{name: string, detect: (cwd?: string) => Promise<Detection>, run: (request: RunRequest) => Promise<Result>}} Provider
 */
export {};

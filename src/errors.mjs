/** @import { ErrorKind, ProviderConfig } from './types.mjs' */

// Only explicitly safe, bridge-owned diagnostics may reach the terminal.
export class InputError extends Error {}

/** @type {Partial<Record<ErrorKind, string[]>>} */
export const DEFAULT_PATTERNS = {
  quota_exhausted: [
    "quota",
    "rate.?limit",
    "too many requests",
    "insufficient.?credits",
    "usage limit",
  ],
  auth_required: [
    "unauthori[sz]ed",
    "not logged in",
    "log.?in required",
    "authentication",
    "invalid.?api.?key",
    "please.*(log|sign).?in",
    '"loggedIn"\\s*:\\s*false',
    '"authMethod"\\s*:\\s*"none"',
  ],
};

/** @param {number} code @param {string} diagnostics @param {ProviderConfig['errorPatterns']} [patterns] @returns {ErrorKind} */
export function classifyError(code, diagnostics, patterns = {}) {
  if (code === 401 || code === 403) return "auth_required";
  if (code === 429) return "quota_exhausted";
  for (const [kind, expressions] of Object.entries({ ...DEFAULT_PATTERNS, ...patterns })) {
    if (expressions.some((expression) => new RegExp(expression, "i").test(diagnostics))) {
      return /** @type {ErrorKind} */ (kind);
    }
  }
  return "nonzero_exit";
}

/** @param {ErrorKind} kind @param {number} [code] @returns {import('./types.mjs').Result} */
export function failure(kind, code = 1) {
  return { text: "", exitCode: code, errorKind: kind };
}

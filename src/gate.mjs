/** @import { Finding, GateConfig } from './types.mjs' */

export class GateError extends Error {
  /** @param {Finding[]} findings */
  constructor(findings) {
    super(
      "Privacy gate blocked the request. Remove sensitive data or configure an exact allowlist entry.",
    );
    this.name = "GateError";
    this.exitCode = 3;
    this.findings = findings;
  }
}

/** @param {string} value */
export function entropy(value) {
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let score = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    score -= p * Math.log2(p);
  }
  return score;
}

/** @param {string} value */
export function luhn(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/** @param {string} value */
export function validIban(value) {
  const compact = value.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rotated = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rotated) {
    for (const digit of /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** Reports contain positions and categories only; never matched values.
 * @param {string} text @param {GateConfig} [config] @param {string} [source] @returns {Finding[]}
 */
export function scan(text, config = {}, source = "prompt") {
  /** @type {Finding[]} */
  const findings = [];
  const allowed = new Set(config.allowlist ?? []);
  const lineStarts = [0];
  for (const newline of text.matchAll(/\n/g)) lineStarts.push(newline.index + 1);
  /** @param {string} kind @param {string} value @param {number} index */
  function report(kind, value, index) {
    if (allowed.has(value)) return;
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= index) low = middle;
      else high = middle;
    }
    findings.push({
      kind,
      source,
      line: low + 1,
      column: index - lineStarts[low] + 1,
    });
  }
  /** @param {string} kind @param {RegExp} regex @param {(value: string) => boolean} [accept] */
  function match(kind, regex, accept = () => true) {
    for (const item of text.matchAll(regex)) {
      const value = item[0];
      if (allowed.has(value) || !accept(value)) continue;
      report(kind, value, item.index);
    }
  }
  match("private_key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g);
  match(
    "api_key",
    /\b(?:sk-(?:proj-|ant-api\d{2}-|or-v1-)?[A-Za-z0-9_-]{20,}|nvapi-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|(?:AKIA|ASIA)[A-Z0-9]{16}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
  );
  match(
    "credential_assignment",
    /(?:secret[_-]?(?:access[_-]?)?key|private[_-]?key|api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret)["']?\s*[=:]\s*["']?[^\s"',;}{]{8,}/gi,
  );
  match("api_key", /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi);
  match("jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g);
  match(
    "high_entropy",
    /(?<![A-Za-z0-9_+/=-])[A-Za-z0-9_+/-]{32,}={0,2}(?![A-Za-z0-9_+/=-])/g,
    (v) =>
      !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(v) &&
      entropy(v) >= 4.3 &&
      /[a-z]/.test(v) &&
      /[A-Z0-9]/.test(v),
  );
  if (config.pii) {
    match("email", /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+\b/gi);
    match("phone", /(?<!\w)\+?\d(?:[\d ().-]{5,}\d)(?!\w)/g, (v) => {
      const digits = v.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 15;
    });
    match("card", /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g, luhn);
    // Test every bounded candidate ending at a word boundary. A following word
    // must not hide an otherwise valid, space-formatted IBAN.
    for (const start of text.matchAll(/\b[A-Z]{2}\d{2}/g)) {
      let candidate = start[0];
      let count = 4;
      for (let i = start.index + 4; i < text.length && count < 34; i++) {
        const char = text[i];
        if (char === " ") {
          candidate += char;
          continue;
        }
        if (!/[A-Z0-9]/.test(char)) break;
        candidate += char;
        count++;
        if (count >= 15 && !/[A-Z0-9]/.test(text[i + 1] ?? "") && validIban(candidate)) {
          report("iban", candidate, start.index);
          break;
        }
      }
    }
  }
  return findings;
}

/** @param {import('./types.mjs').Attachment[]} sources @param {GateConfig} [config] */
export function enforceGate(sources, config = {}) {
  const findings = sources.flatMap((item) => scan(item.text, config, item.name));
  if (findings.length) throw new GateError(findings);
}

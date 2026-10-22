import assert from "node:assert/strict";
import test from "node:test";
import { GateError, enforceGate, entropy, luhn, scan, validIban } from "../src/gate.mjs";

const fakeKey = () => "sk-" + "Ab9xQ2rT7vY4nM6pL8zK3wD5";

test("common secrets, assignments, private keys, and JWTs are detected", () => {
  const samples = [
    fakeKey(),
    "gh" + "p_" + "b".repeat(25),
    "AK" + "IA" + "B".repeat(16),
    "nvapi-" + "x".repeat(24),
    "api_" + "key=" + "synthetic-only",
    "-----BEGIN " + "PRIVATE KEY-----",
    "eyJ" + "x".repeat(10) + "." + "y".repeat(10) + "." + "z".repeat(10),
  ];
  for (const sample of samples) assert.ok(scan(sample).length, sample.slice(0, 4));
});

test("entropy catches unlabeled tokens but ignores git digests", () => {
  const token = "aB3cD4eF5gH6iJ7kL" + "8mN9oP0qR1sT2uV";
  assert.ok(entropy(token) > 4.3);
  assert.ok(scan(token).some((f) => f.kind === "high_entropy"));
  assert.equal(scan("a".repeat(40)).length, 0);
  assert.equal(scan("0123456789abcdef".repeat(4)).length, 0);
});

test("JSON credential assignments and formatted IBANs followed by prose are detected", () => {
  const json = JSON.stringify({ ["pass" + "word"]: "synthetic" + "-password" });
  assert.ok(scan(json).some((f) => f.kind === "credential_assignment"));
  const iban = "GB82 " + "WEST 1234 5698 7654 32";
  assert.ok(scan(iban + " PUBLIC TEXT", { pii: true }).some((f) => f.kind === "iban"));
  assert.ok(!scan(iban, { pii: true, allowlist: [iban] }).some((f) => f.kind === "iban"));
});

test("exact config allowlist works without disabling other checks", () => {
  const key = fakeKey();
  assert.deepEqual(scan(key, { allowlist: [key] }), []);
  assert.ok(scan(key, { allowlist: [key.slice(0, -1)] }).length);
  assert.ok(scan(key + "\n" + "nvapi-" + "y".repeat(25), { allowlist: [key] }).length);
});

test("optional PII detects synthetic email, phone, Luhn card, and IBAN", () => {
  const email = "sample" + "@example.invalid";
  const phone = "+1 " + "202 555 0142";
  const card = "4111" + " 1111 1111 1111";
  const iban = "GB82" + "WEST12345698765432";
  for (const [text, kind] of [
    [email, "email"],
    [phone, "phone"],
    [card, "card"],
    [iban, "iban"],
  ]) {
    assert.ok(
      scan(text, { pii: true }).some((f) => f.kind === kind),
      kind,
    );
    assert.equal(scan(text).length, 0);
  }
  assert.equal(luhn(card), true);
  assert.equal(luhn(card.slice(0, -1) + "2"), false);
  assert.equal(luhn("0".repeat(16)), false);
  assert.equal(validIban(iban), true);
  assert.equal(validIban("GB00" + iban.slice(4)), false);
});

test("reports contain coordinates and no matched text", () => {
  const key = fakeKey();
  const findings = scan("safe\n" + key, {}, "attachment:1");
  assert.equal(findings[0].line, 2);
  assert.equal(findings[0].column, 1);
  assert.ok(!JSON.stringify(findings).includes(key));
  assert.throws(() => enforceGate([{ name: "prompt", text: key }]), GateError);
  assert.equal(scan("Review the implementation and explain tradeoffs.").length, 0);
});

test("credential assignments are detected inside environment-style names", () => {
  const samples = [
    ["OPENAI_API_", "KEY=abcd1234efgh"],
    ["DB_PASS", "WORD=hunter2hunter2"],
    ["GITHUB_TO", "KEN=abcdef123456"],
    ["AWS_SECRET_ACCESS_", "KEY=wJalrXUtnFEMI"],
    ["client", "Secret: abcdefgh1234"],
    ["export MY_TO", "KEN='abcdef123456'"],
  ].map((parts) => parts.join(""));
  for (const sample of samples)
    assert.ok(
      scan(sample).some((f) => f.kind === "credential_assignment"),
      sample.slice(0, 6),
    );
  assert.equal(scan("tokenizer: abcdefgh1234").length, 0);
});

test("additional well-known key formats are detected", () => {
  const samples = [
    "AS" + "IA" + "B".repeat(16),
    "sk_" + "live_" + "Ab9xQ2rT7vY4nM6pL8zK3wD5",
    "glp" + "at-" + "Ab9xQ2rT7vY4nM6pL8zK",
    "Authorization: Bear" + "er " + "Ab9xQ2rT7vY4nM6pL8zK3wD5",
  ];
  for (const sample of samples) assert.ok(scan(sample).length, sample.slice(0, 4));
});

test("PII false positives: public identifiers, versions, hashes and image placeholders", () => {
  const isbn = "978" + "0306406157";
  assert.equal(luhn(isbn), false);
  for (const [label, value] of [
    ["ISBN", isbn],
    ["version", "1.2.3.4567"],
    ["long dotted version", "12.345.678.9012"],
    ["UUID", ["123e4567", "e89b", "12d3", "a456", "123456789012"].join("-")],
    ["40-char hex", "0123456789abcdef".repeat(2) + "01234567"],
    [
      "base64 image",
      "data:image/png;base64," + Buffer.from("synthetic image placeholder only").toString("base64"),
    ],
  ])
    assert.deepEqual(scan(value, { pii: true }), [], label);
});

test("PII true positives use generated mod-97 and Luhn check digits; allowlists stay exact", () => {
  const bban = "TEST" + "0".repeat(14);
  const raw = bban + "GB00";
  let remainder = 0;
  for (const char of raw) {
    for (const digit of /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char)
      remainder = (remainder * 10 + Number(digit)) % 97;
  }
  const iban = "GB" + String(98 - remainder).padStart(2, "0") + bban;
  const prefix = "4" + "2".repeat(14);
  const card = Array.from({ length: 10 }, (_, n) => prefix + n).find(luhn);
  assert.ok(card);
  assert.ok(validIban(iban));
  for (const [value, kind] of [
    [iban, "iban"],
    [card, "card"],
    ["synthetic" + "@example.invalid", "email"],
  ]) {
    assert.ok(
      scan(value, { pii: true }).some((f) => f.kind === kind),
      kind,
    );
    assert.ok(!scan(value, { pii: true, allowlist: [value] }).some((f) => f.kind === kind));
    assert.ok(
      scan(value, { pii: true, allowlist: [value.slice(0, -1)] }).some((f) => f.kind === kind),
    );
  }
  // An image label exempts only entropy heuristics, never explicit key formats.
  assert.ok(scan("data:image/png;base64," + fakeKey()).some((f) => f.kind === "api_key"));
});

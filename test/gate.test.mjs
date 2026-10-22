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

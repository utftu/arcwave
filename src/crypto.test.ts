import { describe, expect, test } from "bun:test";
import { createPKCE, randomToken, sha256Hex, compareSafeTime } from "./arcwave.ts";

const UNRESERVED = /^[A-Za-z0-9\-._~]+$/;

describe("randomToken", () => {
  test("default length encodes to 43 base64url chars (32 bytes)", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9\-_]{43}$/);
  });

  test("respects custom byte length", () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9\-_]{22}$/);
  });

  test("is not padded and has no '+' or '/'", () => {
    const token = randomToken(64);
    expect(token).not.toContain("=");
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
  });

  test("is random across calls", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe("sha256Hex", () => {
  test("matches known FIPS 180-2 vectors", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("createPKCE", () => {
  test("verifier is 43-128 chars from the RFC 7636 unreserved charset", async () => {
    const { verifier } = await createPKCE();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(verifier).toMatch(UNRESERVED);
  });

  test("challenge is BASE64URL(SHA256(verifier)) per RFC 7636 S256", async () => {
    const { verifier, challenge } = await createPKCE();
    const digestHex = await sha256Hex(verifier);
    const expectedChallenge = Uint8Array.fromHex(digestHex).toBase64({
      alphabet: "base64url",
      omitPadding: true,
    });
    expect(challenge).toBe(expectedChallenge);
  });

  test("matches the RFC 7636 appendix B test vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    const expectedHex = Uint8Array.fromBase64(expectedChallenge, {
      alphabet: "base64url",
    }).toHex();
    expect(await sha256Hex(verifier)).toBe(expectedHex);
  });
});

describe("timingSafeEqualStr", () => {
  test("true for identical strings, including empty", () => {
    expect(compareSafeTime("abc", "abc")).toBe(true);
    expect(compareSafeTime("", "")).toBe(true);
  });

  test("false for differing content of equal length", () => {
    expect(compareSafeTime("abc", "abd")).toBe(false);
  });

  test("false for differing length", () => {
    expect(compareSafeTime("abc", "abcd")).toBe(false);
  });
});

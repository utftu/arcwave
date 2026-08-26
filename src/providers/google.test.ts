import { describe, expect, mock, test } from "bun:test";
import type { ProviderConfig } from "../types.ts";

const jwtVerifyMock = mock(async (): Promise<{ payload: Record<string, unknown> }> => ({
  payload: {
    sub: "1",
    email: "a@b.com",
    email_verified: true,
    name: "A",
    nonce: "correct-nonce",
  },
}));

mock.module("jose", () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: jwtVerifyMock,
}));

const { GoogleAuth } = await import("./google.ts");

const config: ProviderConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://app.example.com/callback",
  scope: ["openid", "email", "profile"],
};

describe("GoogleAuth.createUrl", () => {
  test("builds the authorize URL with PKCE + OIDC params", () => {
    const auth = new GoogleAuth(config);
    const url = auth.createUrl({
      state: "state-1",
      nonce: "nonce-1",
      challenge: "challenge-1",
    });

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("GoogleAuth.getToken", () => {
  test("folds the input nonce into the returned tokens", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: "at",
          token_type: "bearer",
          id_token: "it",
          expires_in: 3600,
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    try {
      const auth = new GoogleAuth(config);
      const tokens = await auth.getToken({
        code: "code-1",
        verifier: "verifier-1",
        nonce: "nonce-1",
      });

      expect(tokens.access_token).toBe("at");
      expect(tokens.nonce).toBe("nonce-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("GoogleAuth.getUser", () => {
  const baseTokens = {
    access_token: "at",
    token_type: "bearer",
    id_token: "it",
    expires_in: 3600,
    nonce: "correct-nonce",
  };

  test("returns an Account when nonce and email are valid", async () => {
    const auth = new GoogleAuth(config);
    const account = await auth.getUser(baseTokens);

    expect(account).toEqual({
      id: "1",
      email: "a@b.com",
      name: "A",
      avatarUrl: null,
      raw: expect.anything(),
    });
  });

  test("throws when the nonce doesn't match the id_token claim", async () => {
    const auth = new GoogleAuth(config);
    await expect(
      auth.getUser({ ...baseTokens, nonce: "wrong-nonce" }),
    ).rejects.toThrow("Invalid nonce");
  });

  test("throws when the email is unverified", async () => {
    jwtVerifyMock.mockImplementationOnce(async () => ({
      payload: {
        sub: "1",
        email: "a@b.com",
        email_verified: false,
        name: "A",
        nonce: "correct-nonce",
      },
    }));
    const auth = new GoogleAuth(config);
    await expect(auth.getUser(baseTokens)).rejects.toThrow("Invalid email");
  });

  test("throws when the name is missing", async () => {
    jwtVerifyMock.mockImplementationOnce(async () => ({
      payload: {
        sub: "1",
        email: "a@b.com",
        email_verified: true,
        nonce: "correct-nonce",
      },
    }));
    const auth = new GoogleAuth(config);
    await expect(auth.getUser(baseTokens)).rejects.toThrow("Invalid name");
  });
});

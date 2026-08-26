import { describe, expect, test } from "bun:test";
import type { ProviderConfig } from "../types.ts";
import { GithubAuth } from "./github.ts";

const config: ProviderConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://app.example.com/callback",
  scope: ["read:user", "user:email"],
};

describe("GithubAuth.createUrl", () => {
  test("builds the authorize URL without PKCE/OIDC params", () => {
    const auth = new GithubAuth(config);
    const url = auth.createUrl({
      state: "state-1",
      nonce: "nonce-1",
      challenge: "challenge-1",
    });

    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(url.searchParams.get("state")).toBe("state-1");
    // GitHub OAuth Apps don't support PKCE or OIDC.
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.has("nonce")).toBe(false);
  });
});

describe("GithubAuth.getUser", () => {
  const baseTokens = { access_token: "at", token_type: "bearer", nonce: "x" };

  test("returns the primary verified email as Account.email", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const href = input.toString();
      if (href.includes("/user/emails")) {
        return new Response(
          JSON.stringify([
            { email: "secondary@b.com", primary: false, verified: true },
            { email: "primary@b.com", primary: true, verified: true },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          id: 1,
          login: "octocat",
          name: "Octo Cat",
          avatar_url: "https://img",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    try {
      const auth = new GithubAuth(config);
      const account = await auth.getUser(baseTokens);

      expect(account).toEqual({
        id: "1",
        email: "primary@b.com",
        name: "Octo Cat",
        avatarUrl: "https://img",
        raw: expect.anything(),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws when there is no verified primary email", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const href = input.toString();
      if (href.includes("/user/emails")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          id: 1,
          login: "octocat",
          name: "Octo Cat",
          avatar_url: "https://img",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    try {
      const auth = new GithubAuth(config);
      await expect(auth.getUser(baseTokens)).rejects.toThrow("Invalid email");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws when the GitHub user has no name", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const href = input.toString();
      if (href.includes("/user/emails")) {
        return new Response(
          JSON.stringify([
            { email: "primary@b.com", primary: true, verified: true },
          ]),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          id: 1,
          login: "octocat",
          name: null,
          avatar_url: "https://img",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    try {
      const auth = new GithubAuth(config);
      await expect(auth.getUser(baseTokens)).rejects.toThrow("Invalid name");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

import { describe, expect, test } from "bun:test";
import type { ProviderConfig } from "../types.ts";
import { YandexAuth } from "./yandex.ts";

const config: ProviderConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://app.example.com/callback",
  scope: ["login:email", "login:info", "login:avatar"],
};

const baseUser = {
  id: "1000000000",
  login: "ivan",
  display_name: "Иван",
  real_name: "Иван Иванов",
  default_email: "ivan@yandex.ru",
  emails: ["ivan@yandex.ru"],
  default_avatar_id: "avatar-id",
  is_avatar_empty: false,
};

type FetchInit = { headers?: Record<string, string> };

function mockFetch(
  user: Record<string, unknown>,
  onRequest?: (init: FetchInit | undefined) => void,
): typeof fetch {
  return (async (_input: string | URL | Request, init?: FetchInit) => {
    onRequest?.(init);
    return new Response(JSON.stringify(user), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("YandexAuth.createUrl", () => {
  test("builds the authorize URL with PKCE and without OIDC params", () => {
    const auth = new YandexAuth(config);
    const url = auth.createUrl({
      state: "state-1",
      nonce: "nonce-1",
      challenge: "challenge-1",
    });

    expect(url.origin + url.pathname).toBe(
      "https://oauth.yandex.com/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(
      "login:email login:info login:avatar",
    );
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // Yandex ID has no OIDC id_token to bind a nonce to.
    expect(url.searchParams.has("nonce")).toBe(false);
  });
});

describe("YandexAuth.getUser", () => {
  const baseTokens = {
    access_token: "at",
    token_type: "bearer",
    nonce: "x",
    expires_in: 3600,
  };

  test("maps the default email, display name and avatar into an Account", async () => {
    const originalFetch = globalThis.fetch;
    let headers: Record<string, string> | undefined;
    globalThis.fetch = mockFetch(baseUser, (init) => {
      headers = init?.headers;
    });

    try {
      const auth = new YandexAuth(config);
      const account = await auth.getUser(baseTokens);

      // Yandex expects the `OAuth` scheme, not `Bearer`.
      expect(headers).toEqual({ Authorization: "OAuth at" });
      expect(account).toEqual({
        id: "1000000000",
        email: "ivan@yandex.ru",
        name: "Иван",
        avatarUrl: "https://avatars.yandex.net/get-yapic/avatar-id/islands-200",
        raw: expect.anything(),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns a null avatar when Yandex serves the placeholder picture", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({ ...baseUser, is_avatar_empty: true });

    try {
      const auth = new YandexAuth(config);
      const account = await auth.getUser(baseTokens);

      expect(account.avatarUrl).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws when the account has no default email", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({ ...baseUser, default_email: undefined });

    try {
      const auth = new YandexAuth(config);
      await expect(auth.getUser(baseTokens)).rejects.toThrow("Invalid email");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws when the account has no display name", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch({ ...baseUser, display_name: undefined });

    try {
      const auth = new YandexAuth(config);
      await expect(auth.getUser(baseTokens)).rejects.toThrow("Invalid name");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

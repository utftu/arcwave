import { afterEach, describe, expect, test } from "bun:test";
import { getToken } from "./token.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getToken", () => {
  test("returns parsed JSON on success", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ access_token: "abc", token_type: "bearer" }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const result = await getToken<{ access_token: string; token_type: string }>(
      "https://example.com/token",
      { code: "123" },
    );

    expect(result).toEqual({ access_token: "abc", token_type: "bearer" });
  });

  test("throws with the provider's error message on an error response", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      })) as unknown as typeof fetch;

    await expect(
      getToken("https://example.com/token", { code: "bad" }),
    ).rejects.toThrow("invalid_grant");
  });

  test("omits undefined body values from the form-encoded request", async () => {
    let sentBody: string | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = init?.body?.toString();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    await getToken("https://example.com/token", {
      code: "123",
      redirect_uri: undefined,
    });

    expect(sentBody).toBe("code=123");
  });

  test("sends Accept: application/json alongside any custom headers", async () => {
    let sentHeaders: Headers | undefined;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sentHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;

    await getToken(
      "https://example.com/token",
      { code: "123" },
      { "X-Custom": "1" },
    );

    expect(sentHeaders?.get("Accept")).toBe("application/json");
    expect(sentHeaders?.get("X-Custom")).toBe("1");
  });
});

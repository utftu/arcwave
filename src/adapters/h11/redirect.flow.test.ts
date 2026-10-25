import { describe, expect, test } from "bun:test";
import type { AuthCore } from "../../core.ts";
import { createAuthGuard } from "./guard.ts";
import { createStage1Handler } from "./stage1.ts";

const providers = {
  google: {
    createUrl: () => new URL("https://provider.example.com/authorize"),
  } as unknown as AuthCore,
};

// h11 encodes cookie values on write and decodes them on read, so the raw
// header carries the percent-encoded form.
function getRedirectCookie(response: Response): string | undefined {
  const raw = response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("arcwave_redirect="))
    ?.match(/arcwave_redirect=([^;]*)/)?.[1];

  return raw === undefined ? undefined : decodeURIComponent(raw);
}

async function stage1(url: string, checkRedirect?: RegExp): Promise<Response> {
  const handler = createStage1Handler({
    provider: "google",
    providers,
    checkRedirect,
  });

  return (await handler({ req: new Request(url) } as any)) as Response;
}

describe("createStage1Handler with ?redirect=", () => {
  test("stores a local path in the redirect cookie", async () => {
    const response = await stage1(
      "https://app.example.com/auth/google/stage1?redirect=%2Fdashboard%3Ftab%3D1",
    );

    expect(getRedirectCookie(response)).toBe("/dashboard?tab=1");
  });

  test("drops a value pointing at another host", async () => {
    const response = await stage1(
      "https://app.example.com/auth/google/stage1?redirect=%2F%2Fevil.ru%2Fpwn",
    );

    expect(getRedirectCookie(response)).toBeUndefined();
  });

  test("sets no cookie when the query has no redirect", async () => {
    const response = await stage1("https://app.example.com/auth/google/stage1");

    expect(getRedirectCookie(response)).toBeUndefined();
  });

  test("honours a custom rule", async () => {
    const response = await stage1(
      "https://app.example.com/auth/google/stage1?redirect=%2F2fa",
      /^\/[a-z]/,
    );

    expect(getRedirectCookie(response)).toBeUndefined();
  });
});

describe("createAuthGuard without a session", () => {
  async function guard(url: string, redirectTo?: string) {
    const module = createAuthGuard({
      db: {} as any,
      sessionsTable: {} as any,
      usersTable: {} as any,
      redirectTo,
    });

    return (await module({ req: new Request(url), data: {} } as any)) as Response;
  }

  test("passes the requested path on to the login route", async () => {
    const response = await guard(
      "https://app.example.com/dashboard?tab=1",
      "/login",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/login?redirect=%2Fdashboard%3Ftab%3D1",
    );
  });

  test("still answers 401 when no login route is configured", async () => {
    const response = await guard("https://app.example.com/dashboard");

    expect(response.status).toBe(401);
  });
});

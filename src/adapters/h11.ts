import type { Context, Handler } from "h11";
import { compareSafeTime, createPKCE, randomToken } from "../arcwave.ts";
import type { Account } from "../http.ts";
import type { GoogleAuth } from "../providers/google.ts";

const COOKIE_STATE = "arcwave_state";
const COOKIE_NONCE = "arcwave_nonce";
const COOKIE_VERIFIER = "arcwave_verifier";
const COOKIE_MAX_AGE = 600; // flow must complete within 10 minutes

function serializeCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) {
      out[key] = decodeURIComponent(value);
    }
  }
  return out;
}

export type H11GoogleHandlersOptions = {
  scope: string[];
  onSuccess: (account: Account, ctx: Context) => Response | Promise<Response>;
};

export function createGoogleHandlers(
  auth: GoogleAuth,
  opts: H11GoogleHandlersOptions,
): { handleStage1: Handler; handleStage2: Handler } {
  const handleStage1: Handler = async () => {
    const state = randomToken();
    const nonce = randomToken();
    const { verifier, challenge } = await createPKCE();

    const url = auth.createUrl({
      state,
      nonce,
      scope: opts.scope,
      codeChallenge: challenge,
    });

    const headers = new Headers({ Location: url.toString() });
    headers.append("Set-Cookie", serializeCookie(COOKIE_STATE, state, COOKIE_MAX_AGE));
    headers.append("Set-Cookie", serializeCookie(COOKIE_NONCE, nonce, COOKIE_MAX_AGE));
    headers.append("Set-Cookie", serializeCookie(COOKIE_VERIFIER, verifier, COOKIE_MAX_AGE));

    return new Response(null, { status: 302, headers });
  };

  const handleStage2: Handler = async (ctx) => {
    const { req } = ctx;
    const url = new URL(req.url);

    // 1. `error` in query -> user cancelled, not a failure.
    if (url.searchParams.get("error")) {
      throw new Response("Authorization was cancelled or denied.", { status: 400 });
    }

    // 2. presence of code/state.
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      throw new Response("Missing code or state.", { status: 400 });
    }

    // 3. presence of flow cookies.
    const cookies = parseCookies(req.headers.get("cookie"));
    const cookieState = cookies[COOKIE_STATE];
    const cookieVerifier = cookies[COOKIE_VERIFIER];
    if (!cookieState || !cookieVerifier) {
      throw new Response("Missing or expired auth session.", { status: 400 });
    }

    // Cookies are single-use regardless of outcome — clear them before any
    // network call, per the checklist (step 4).
    const clearHeaders = new Headers();
    clearHeaders.append("Set-Cookie", clearCookie(COOKIE_STATE));
    clearHeaders.append("Set-Cookie", clearCookie(COOKIE_NONCE));
    clearHeaders.append("Set-Cookie", clearCookie(COOKIE_VERIFIER));

    // 4. `state` check, constant-time.
    if (!compareSafeTime(state, cookieState)) {
      throw new Response("Invalid state.", { status: 400, headers: clearHeaders });
    }

    // 5. exchange code -> tokens.
    const tokens = await auth.getToken({ code, codeVerifier: cookieVerifier });

    // 6-7. id_token signature/iss/aud/exp verified inside getUser.
    const account = await auth.getUser(tokens);

    // 8. (provider, sub) lookup/linking is application code, not this library's job.
    const response = await opts.onSuccess(account, ctx);
    for (const [key, value] of clearHeaders) {
      response.headers.append(key, value);
    }
    return response;
  };

  return { handleStage1, handleStage2 };
}

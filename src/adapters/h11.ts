import { deleteCookie, getCookie, setCookie } from "h11";
import type { Context, Handler } from "h11";
import { compareSafeTime, createPKCE, randomToken } from "../arcwave.ts";
import type { Account, AuthCore } from "../core.ts";

const COOKIE_STATE = "arcwave_state";
const COOKIE_NONCE = "arcwave_nonce";
const COOKIE_VERIFIER = "arcwave_verifier";
const COOKIE_MAX_AGE = 600; // flow must complete within 10 minutes

function createReponse(text: string, code: number, opts?: Record<string, any>) {
  return new Response(text, { status: code, ...opts });
}

const COOKIE_OPTIONS = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "Lax" as const,
  maxAge: COOKIE_MAX_AGE,
};

export function clearAuthCookies(response: Response): void {
  deleteCookie(response, COOKIE_STATE, { path: "/" });
  deleteCookie(response, COOKIE_NONCE, { path: "/" });
  deleteCookie(response, COOKIE_VERIFIER, { path: "/" });
}

type Providers = Record<string, AuthCore>;

function getProvider(providers: Providers, ctx: Context): AuthCore {
  const name = ctx.params.provider || "";
  const auth = providers[name];
  if (!auth) {
    throw new Response(`Unknown provider "${name}".`, { status: 404 });
  }
  return auth;
}

type PropsStage2 = { providers: Providers };

// generateTokens createUrl redirect

// const auth = getAuth(provider, providers)
// const tokens = generateTokens()
// const url = createUrl({auth, tokens})
// const redirect = createRedirect(url)

export function createStage1Handler(props: {
  provider: string;
  providers: Providers;
}) {
  return async (provider: string, ctx: Context) => {
    const auth = getProvider(providers, ctx);

    const state = randomToken();
    const nonce = randomToken();
    const { verifier, challenge } = await createPKCE();

    const url = await auth.createUrl({
      state,
      nonce,
      challenge,
    });

    const response = new Response(null, {
      status: 302,
      headers: { Location: url.toString() },
    });

    setCookie(response, COOKIE_STATE, state, COOKIE_OPTIONS);
    setCookie(response, COOKIE_NONCE, nonce, COOKIE_OPTIONS);
    setCookie(response, COOKIE_VERIFIER, verifier, COOKIE_OPTIONS);

    return response;
  };
}

export function createStage2Handler(providers: Providers): Handler {
  return async (ctx) => {
    const auth = getProvider(providers, ctx);
    const url = new URL(ctx.req.url);

    if (url.searchParams.get("error")) {
      return createReponse("Authorization was cancelled or denied", 400);
    }

    const code = url.searchParams.get("code");
    if (!code) {
      return createReponse("Missing state", 400);
    }

    const state = url.searchParams.get("state");
    if (!state || state !== getCookie(ctx.req, COOKIE_STATE)) {
      const response = createReponse("Invalid state", 400);
      clearAuthCookies(response);
      return response;
    }

    const cookieVerifier = getCookie(ctx.req, COOKIE_VERIFIER);
    if (!cookieVerifier) {
      const response = createReponse("Missing or expired auth session", 400);
      clearAuthCookies(response);
      return response;
    }

    const tokens = await auth.getToken({ code, verifier: cookieVerifier });
    const account = await auth.getUser(tokens);

    // 8. (provider, sub) lookup/linking is application code, not this library's job —
    // hand the account off via `ctx.data` and let the chain continue: register this
    // handler as `h11.get(pattern, createStage2Handler(), yourHandler)`, where
    // `yourHandler` reads `(ctx.data as { account: Account }).account`, builds the
    // session/response, and should call `clearAuthCookies(response)` on its way out.
    (ctx.data as { account?: Account }).account = account;
  };
}

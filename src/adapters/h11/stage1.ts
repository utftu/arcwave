import { setCookie, type Handler } from "h11";
import type { AuthCore } from "../../core.ts";
import { createPKCE, randomToken } from "../../crypto/crypto.ts";
import {
  COOKIE_NONCE,
  COOKIE_OPTIONS,
  COOKIE_REDIRECT,
  COOKIE_STATE,
  COOKIE_VERIFIER,
} from "./const.ts";
import { createRedirectCheck, type CheckRedirect } from "./redirect.ts";
import type { Providers } from "./types.ts";
import { createReponse, getAuth } from "./utils.ts";

type FlowSecrets = {
  state: string;
  nonce: string;
  verifier: string;
  challenge: string;
};

async function generateFlowSecretsStage(): Promise<FlowSecrets> {
  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = await createPKCE();
  return { state, nonce, verifier, challenge };
}

function createUrlStage(props: {
  auth: AuthCore;
  secrets: FlowSecrets;
}): Promise<URL> | URL {
  return props.auth.createUrl({
    state: props.secrets.state,
    nonce: props.secrets.nonce,
    challenge: props.secrets.challenge,
  });
}

function createRedirectStage(url: URL, secrets: FlowSecrets): Response {
  const response = new Response(null, {
    status: 302,
    headers: { Location: url.toString() },
  });

  setCookie(response, COOKIE_STATE, secrets.state, COOKIE_OPTIONS);
  setCookie(response, COOKIE_NONCE, secrets.nonce, COOKIE_OPTIONS);
  setCookie(response, COOKIE_VERIFIER, secrets.verifier, COOKIE_OPTIONS);

  return response;
}

export function createStage1Handler({
  provider,
  providers,
  checkRedirect,
}: {
  providers: Providers;
  provider?: string;
  checkRedirect?: CheckRedirect;
}): Handler {
  const check = createRedirectCheck(checkRedirect);

  return async (ctx) => {
    if (!provider) {
      return createReponse(`Not valid provider: ${provider}`, 518);
    }
    const auth = getAuth(provider, providers);
    const secrets = await generateFlowSecretsStage();
    const url = await createUrlStage({ auth, secrets });
    const response = createRedirectStage(url, secrets);

    // `redirect` arrives from the query string, so this is where it gets
    // checked; a value that doesn't pass is dropped and stage2 falls back to
    // its own `redirect`.
    const requested = new URL(ctx.req.url).searchParams.get("redirect");
    if (requested && check(requested)) {
      setCookie(response, COOKIE_REDIRECT, requested, COOKIE_OPTIONS);
    }

    return response;
  };
}

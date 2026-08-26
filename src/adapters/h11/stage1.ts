import { setCookie, type Handler } from "h11";
import type { AuthCore } from "../../core.ts";
import { createPKCE, randomToken } from "../../crypto/crypto.ts";
import {
  COOKIE_NONCE,
  COOKIE_OPTIONS,
  COOKIE_STATE,
  COOKIE_VERIFIER,
} from "./const.ts";
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
}: {
  providers: Providers;
  provider?: string;
}): Handler {
  return async () => {
    if (!provider) {
      return createReponse(`Not valid provider: ${provider}`, 518);
    }
    const auth = getAuth(provider, providers);
    const secrets = await generateFlowSecretsStage();
    const url = await createUrlStage({ auth, secrets });
    return createRedirectStage(url, secrets);
  };
}

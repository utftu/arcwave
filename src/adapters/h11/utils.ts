import type { AuthCore } from "../../core.ts";
import type { Providers } from "./types.ts";

export function createReponse(
  text: string,
  code: number = 200,
  opts?: Record<string, any>,
) {
  return new Response(text, { status: code, ...opts });
}

export function createRedirect(redirect: string) {
  return new Response(null, { status: 302, headers: { Location: redirect } });
}

export function getAuth(provider: string, providers: Providers): AuthCore {
  const auth = providers[provider];
  if (!auth) {
    throw new Response(`Unknown provider "${provider}".`, { status: 404 });
  }
  return auth;
}

import { createRemoteJWKSet, jwtVerify } from "jose";
import { buildUrl } from "../utils.ts";
import { getToken } from "../token.ts";
import {
  AuthCore,
  type Account,
  type CreateUrlBaseProps,
  type GetTokenBaseProps,
  type GetUserBaseProps,
} from "../core.ts";
import type { ProviderConfig } from "../types.ts";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const jwks = createRemoteJWKSet(new URL(JWKS_URI));

export type GoogleCreateUrlProps = CreateUrlBaseProps;

export type GoogleGetTokenProps = GetTokenBaseProps;

export type GoogleTokens = GetUserBaseProps & {
  id_token: string;
  expires_in: number;
  refresh_token?: string;
};

type GoogleIDTokenClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

export class GoogleAuth extends AuthCore<
  GoogleCreateUrlProps,
  GoogleGetTokenProps,
  GoogleTokens
> {
  createUrl(props: GoogleCreateUrlProps): URL {
    return buildUrl(AUTHORIZATION_ENDPOINT, {
      client_id: this.config.clientId,
      redirect_uri: props.redirectUri ?? this.config.redirectUri,
      response_type: "code",
      scope: this.config.scope.join(" "),
      state: props.state,
      nonce: props.nonce,
      code_challenge: props.challenge,
      code_challenge_method: "S256",
    });
  }

  getToken(props: GoogleGetTokenProps): Promise<GoogleTokens> {
    return getToken<GoogleTokens>(TOKEN_ENDPOINT, {
      grant_type: "authorization_code",
      code: props.code,
      redirect_uri: props.redirectUri ?? this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code_verifier: props.verifier,
    });
  }

  async getUser(tokens: GoogleTokens): Promise<Account> {
    const { payload } = await jwtVerify<GoogleIDTokenClaims>(
      tokens.id_token,
      jwks,
      {
        issuer: ISSUERS,
        audience: this.config.clientId,
      },
    );

    if (payload.email_verified === false || !payload.email) {
      throw new Error("Invalid email");
    }

    if (!payload.name) {
      throw new Error("Invalid name");
    }

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      avatarUrl: payload.picture ?? null,
      raw: payload,
    };
  }
}

export function google(config: ProviderConfig): GoogleAuth {
  return new GoogleAuth(config);
}

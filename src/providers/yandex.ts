import { buildUrl } from "../utils.ts";
import { getToken } from "../token/token.ts";
import {
  AuthCore,
  type Account,
  type CreateUrlBaseProps,
  type GetTokenBaseProps,
  type GetUserBaseProps,
} from "../core.ts";
import type { ProviderConfig } from "../types.ts";

const AUTHORIZATION_ENDPOINT = "https://oauth.yandex.com/authorize";
const TOKEN_ENDPOINT = "https://oauth.yandex.com/token";
// Yandex ID only serves the user info API from the .ru host — login.yandex.com
// answers 404.
const USER_ENDPOINT = "https://login.yandex.ru/info";
const AVATAR_ENDPOINT = "https://avatars.yandex.net/get-yapic";
const AVATAR_SIZE = "islands-200";

export type YandexCreateUrlProps = CreateUrlBaseProps;

export type YandexGetTokenProps = GetTokenBaseProps;

export type YandexTokens = GetUserBaseProps & {
  expires_in: number;
  refresh_token?: string;
};

type YandexUser = {
  id: string;
  login: string;
  display_name?: string;
  real_name?: string;
  default_email?: string;
  emails?: string[];
  default_avatar_id?: string;
  is_avatar_empty?: boolean;
};

export class YandexAuth extends AuthCore<
  YandexCreateUrlProps,
  YandexGetTokenProps,
  YandexTokens
> {
  // Yandex ID supports PKCE but not OIDC — there's no id_token, so `nonce` is
  // part of the shared flow props with nothing to check it against here.
  createUrl(props: YandexCreateUrlProps): URL {
    return buildUrl(AUTHORIZATION_ENDPOINT, {
      client_id: this.config.clientId,
      redirect_uri: props.redirectUri ?? this.config.redirectUri,
      response_type: "code",
      scope: this.config.scope.join(" "),
      state: props.state,
      code_challenge: props.challenge,
      code_challenge_method: "S256",
    });
  }

  getToken(props: YandexGetTokenProps): Promise<YandexTokens> {
    return getToken<YandexTokens>(TOKEN_ENDPOINT, {
      grant_type: "authorization_code",
      code: props.code,
      redirect_uri: props.redirectUri ?? this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code_verifier: props.verifier,
    });
  }

  // Yandex ID carries no `email_verified` equivalent. `default_email` is the
  // account's own mailbox (the `emails` array holds nothing else today), so it
  // is treated as verified — that assumption is what keeps account linking by
  // email safe here.
  async getUser(tokens: YandexTokens): Promise<Account> {
    const response = await fetch(USER_ENDPOINT, {
      // Yandex expects the `OAuth` scheme here, not `Bearer`.
      headers: { Authorization: `OAuth ${tokens.access_token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Yandex user: ${response.status}`);
    }

    const user = (await response.json()) as YandexUser;

    if (!user.default_email) {
      throw new Error("Invalid email");
    }

    if (!user.display_name) {
      throw new Error("Invalid name");
    }

    // `is_avatar_empty` means `default_avatar_id` points at the placeholder
    // picture Yandex assigns on registration.
    const avatarUrl =
      user.default_avatar_id && !user.is_avatar_empty
        ? `${AVATAR_ENDPOINT}/${user.default_avatar_id}/${AVATAR_SIZE}`
        : null;

    return {
      id: user.id,
      email: user.default_email,
      name: user.display_name,
      avatarUrl,
      raw: user,
    };
  }
}

export function yandex(config: ProviderConfig): YandexAuth {
  return new YandexAuth(config);
}

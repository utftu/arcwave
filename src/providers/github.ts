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

const AUTHORIZATION_ENDPOINT = "https://github.com/login/oauth/authorize";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const USER_ENDPOINT = "https://api.github.com/user";
const EMAILS_ENDPOINT = "https://api.github.com/user/emails";

export type GithubCreateUrlProps = CreateUrlBaseProps;

export type GithubGetTokenProps = GetTokenBaseProps;

export type GithubTokens = GetUserBaseProps & {
  refresh_token?: string;
};

type GithubUser = {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
};

type GithubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export class GithubAuth extends AuthCore<
  GithubCreateUrlProps,
  GithubGetTokenProps,
  GithubTokens
> {
  // GitHub OAuth Apps don't support PKCE or OIDC — `challenge`/`nonce` are part
  // of the shared flow props (every provider gets them from stage1), but this
  // provider has nothing to check them against, so they're intentionally unused.
  createUrl(props: GithubCreateUrlProps): URL {
    return buildUrl(AUTHORIZATION_ENDPOINT, {
      client_id: this.config.clientId,
      redirect_uri: props.redirectUri ?? this.config.redirectUri,
      scope: this.config.scope.join(" "),
      state: props.state,
    });
  }

  getToken(props: GithubGetTokenProps): Promise<GithubTokens> {
    return getToken<GithubTokens>(TOKEN_ENDPOINT, {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: props.code,
      redirect_uri: props.redirectUri ?? this.config.redirectUri,
    });
  }

  async getUser(tokens: GithubTokens): Promise<Account> {
    const headers = {
      Authorization: `Bearer ${tokens.access_token}`,
      Accept: "application/vnd.github+json",
    };

    const userRes = await fetch(USER_ENDPOINT, { headers });
    if (!userRes.ok) {
      throw new Error(`Failed to fetch GitHub user: ${userRes.status}`);
    }
    const user = (await userRes.json()) as GithubUser;

    // GitHub's /user endpoint only returns a public email if the user opted
    // in — /user/emails is the only reliable way to get a verified one, which
    // is the same invariant GoogleAuth.getUser enforces before returning.
    const emailsRes = await fetch(EMAILS_ENDPOINT, { headers });
    if (!emailsRes.ok) {
      throw new Error(`Failed to fetch GitHub emails: ${emailsRes.status}`);
    }
    const emails = (await emailsRes.json()) as GithubEmail[];
    const primary = emails.find((email) => email.primary && email.verified);

    if (!primary) {
      throw new Error("Invalid email");
    }

    if (!user.name) {
      throw new Error("Invalid name");
    }

    return {
      id: String(user.id),
      email: primary.email,
      name: user.name,
      avatarUrl: user.avatar_url,
      raw: { user, emails },
    };
  }
}

export function github(config: ProviderConfig): GithubAuth {
  return new GithubAuth(config);
}

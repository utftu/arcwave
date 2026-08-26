import type { ProviderConfig } from "./types.ts";

export type CreateUrlBaseProps = {
  state: string;
  nonce: string;
  challenge: string;
  redirectUri?: string;
};

export type GetTokenBaseProps = {
  code: string;
  verifier: string;
  nonce: string;
  redirectUri?: string;
};

export type GetUserBaseProps = {
  access_token: string;
  token_type: string;
  nonce: string;
  scope?: string;
};

export type Account = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  raw: unknown;
};

export abstract class AuthCore<
  CreateUrlProps extends CreateUrlBaseProps = CreateUrlBaseProps,
  GetTokenProps extends GetTokenBaseProps = GetTokenBaseProps,
  GetUserProps extends GetUserBaseProps = GetUserBaseProps,
> {
  constructor(public readonly config: ProviderConfig) {}

  abstract createUrl(opts: CreateUrlProps): Promise<URL> | URL;
  abstract getToken(input: GetTokenProps): Promise<GetUserProps>;
  abstract getUser(tokens: GetUserProps): Promise<Account>;
}

export type ProviderConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type CreateUrlBaseProps = {
  state: string;
  scope: string[];
  redirectUri?: string;
};

export type GetTokenBaseProps = {
  code: string;
  redirectUri?: string;
};

export type GetUserBaseProps = {
  access_token: string;
  token_type: string;
  scope?: string;
};

export type Account = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  raw: unknown;
};

export abstract class HttpAuth<
  CreateUrlProps extends CreateUrlBaseProps = CreateUrlBaseProps,
  GetTokenProps extends GetTokenBaseProps = GetTokenBaseProps,
  GetUserProps extends GetUserBaseProps = GetUserBaseProps,
> {
  constructor(protected readonly config: ProviderConfig) {}

  abstract createUrl(opts: CreateUrlProps): Promise<URL> | URL;
  abstract getToken(input: GetTokenProps): Promise<GetUserProps>;
  abstract getUser(tokens: GetUserProps): Promise<Account>;
}

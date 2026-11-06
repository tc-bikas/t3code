import * as Schema from "effect/Schema";

export interface GithubProfile {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export interface GithubEmail {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

/** The three GitHub calls sign-in needs. Implementations throw on any failure. */
export interface GithubClient {
  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<string>;
  fetchProfile(accessToken: string): Promise<GithubProfile>;
  fetchEmails(accessToken: string): Promise<ReadonlyArray<GithubEmail>>;
}

const TokenResponse = Schema.Struct({ access_token: Schema.String });
const UserResponse = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});
const EmailsResponse = Schema.Array(
  Schema.Struct({ email: Schema.String, primary: Schema.Boolean, verified: Schema.Boolean }),
);

const decodeToken = Schema.decodeUnknownSync(TokenResponse);
const decodeUser = Schema.decodeUnknownSync(UserResponse);
const decodeEmails = Schema.decodeUnknownSync(EmailsResponse);

const TIMEOUT_MS = 10_000;

async function getJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return response.json();
}

const apiHeaders = (accessToken: string) => ({
  accept: "application/vnd.github+json",
  authorization: `Bearer ${accessToken}`,
  "user-agent": "t3-team",
  "x-github-api-version": "2022-11-28",
});

export function createGithubClient(): GithubClient {
  return {
    async exchangeCode({ clientId, clientSecret, code, codeVerifier, redirectUri }) {
      const body = await getJson("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "t3-team",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        }),
      });
      return decodeToken(body).access_token;
    },
    async fetchProfile(accessToken) {
      const user = decodeUser(
        await getJson("https://api.github.com/user", { headers: apiHeaders(accessToken) }),
      );
      return {
        id: user.id,
        login: user.login,
        name: user.name ?? null,
        avatarUrl: user.avatar_url ?? null,
      };
    },
    async fetchEmails(accessToken) {
      return decodeEmails(
        await getJson("https://api.github.com/user/emails", { headers: apiHeaders(accessToken) }),
      );
    },
  };
}

# ROUT as a Sovereign Identity Broker — architecture

## 1. Why the social login buttons disappeared

**Cause (confirmed in the code):** `src/pages/AuthNeon.tsx` filtered the icon grid against
`getEnabledProviders()`, which returns `google`, `github`, and so on only when the exact
variables `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (and the same pattern for the others)
are present in the **server runtime**. Three ways to get an empty list:

1. On Vercel the variables have a different name, or are only set for "Production" while you
   test on a Preview deployment.
2. The variables were added after the last deployment. Vercel needs a redeploy.
3. The request fails, for example on a cold start or a database error. The `catch` set the
   list to `[]`, which hides **every** button.

The OIDC provider code (`src/lib/oauth/provider.server.ts`, `/oauth/authorize`, `/api/public/oauth/*`,
`/.well-known/*`) reads **no** `OIDC_*` client variables and does not overwrite the Better Auth
config. So the client config was not overwritten. The cause is the "hide without keys" filter.

**Fix (done):** the grid is always visible. A provider without keys sends no request and shows
"Deze inlogoptie is nog niet actief".

**Strict separation (rule):**

| Role | Where | Config |
|---|---|---|
| Logging in **ON** rout.be (client) | `better-auth.server.ts`, `/api/auth/*` | `GOOGLE_*`, `GITHUB_*`, `GITLAB_*`, `APPLE_*`, `INFOMANIAK_*`, `OIDC_*` (an external IdP) |
| Logging in **VIA** rout.be (provider) | `lib/oauth/*`, `/oauth/authorize`, `/api/public/oauth/*` | Only its own tables (`oauth_clients`, …) and its own signing keys. Never import from `better-auth.server.ts` except to read the session. |

New provider variables always get the prefix `ROUT_PROVIDER_*`.

## 2. Neon schema and data minimization

Scopes for upstream providers: only `openid profile email`.

```text
users(id uuid pk, primary_email citext unique, email_verified_at, created_at)
identities(id, user_id fk, provider, provider_sub, email, email_verified,
           display_meta jsonb, linked_at, last_login_at,
           unique(provider, provider_sub))
oidc_clients(client_id pk, owner_user_id, name, redirect_uris text[],
             secret_hash, pairwise_salt, require_acr text, created_at)
oidc_consents(user_id, client_id, scopes text[], granted_at, pk(user_id, client_id))
oidc_codes(code_hash pk, user_id, client_id, nonce, pkce_challenge, acr, expires_at)
oidc_signing_keys(kid pk, private_jwk_enc, public_jwk, created_at, retired_at)
```

**Rich identity:** `display_meta` is filled **once** at linking (and refreshed on the next
login) from the ID token / userinfo that we already receive: `{name, avatar_url, username,
public_count?}`. No extra scopes and no background calls. Counts such as "5 projects" are only
stored if the provider exposes them publicly with the basic scope (GitHub `public_repos` via
`/user`). Otherwise they are left out.

## 3. Login flows

- **Seamless:** a valid session plus an existing consent for `client_id`, and `prompt` is not
  `login` or `consent` → show the confirmation screen right away with `display_meta` (photo,
  name, method).
- **Strict / merge:** triggered by `prompt=login`, `max_age`, `acr_values=urn:rout:acr:strict`,
  or a **new** provider with an email that already exists. Steps:
  1. Never link automatically (`trustedProviders: []` stays).
  2. Re-authenticate with a method that is already linked, **plus** a 6-digit email OTP
     (expires in 10 min, hashed, 5 attempts).
  3. Only then insert into `identities` under the existing `user_id`, and write a
     `security_events` record.
- `login_hint` only pre-fills the email field. It never decides the account.

## 4. A stable `sub`

`sub = base64url(HMAC-SHA256(pairwise_salt_of_client, users.id))`: pairwise per client,
immutable, and **never** derived from Google, Telegram or email. Changing the login method
does not change `users.id`, so the `sub` stays the same.

## 5. Vercel and Neon pitfalls

- Use the **pooled** Neon URL (`…-pooler…`) with the serverless HTTP driver (`@neondatabase/serverless`).
  Don't keep TCP pools open between invocations.
- Cold starts: keep `/api/auth/*` and the token endpoint light. Use dynamic imports, which the code already does.
- Function duration (10 s on Hobby, 60 s on Pro): no synchronous follower or social sync in a
  request. Cron routes go under `/api/public/cron/*` with `LOVABLE_CRON_SECRET`.
- Signing keys are stored in the database, not in memory. Each instance reads JWKS from Neon (with a short cache).
- **Build:** set `NITRO_PRESET=vercel` in Vercel → Environment Variables. The default target is
  an edge worker.
- Set every variable for Production **and** Preview, then redeploy.

## Developer Console — final UI structure

```text
/console/apps                       App overview: grid of cards, "Nieuwe app", delete with confirmation
/console/apps/$appId                -> redirects to credentials
  credentials                       Client ID (copy), rotate secret (shown once), discovery URL
  branding                          Name, logo URL (live preview), website, privacy, terms
  redirects                         Callback URLs: add / remove / validate (https, http only for localhost, no #fragment)
  scopes                            openid (required), profile, email + PKCE authorize snippet
  security                          Flow: Seamless | Strict, Rich Identity toggle
```
The Developer Hub "Login met ROUT" tab is a single card linking to `/console/apps`.

## OIDC parameters on /oauth/authorize

| Parameter | Effect |
|---|---|
| `response_type=code` | Authorization code flow (only supported type) |
| `client_id`, `redirect_uri` | Must match a registered app and an exact registered redirect |
| `scope` | `openid` required; `profile`, `email` optional |
| `code_challenge` + `code_challenge_method=S256` | PKCE, mandatory |
| `state`, `nonce` | Echoed back / embedded in the ID token |
| `prompt=login` | Forces the 6-digit step-up code |
| `max_age` | Any value forces the step-up code |
| `acr_values=urn:rout:acr:strict` | Forces the step-up code; the ID token then carries `acr` |

Step-up is also required whenever the app's `flow_preference` is `strict`. Rich Identity (public activity) is shared only when the app enabled it **and** the user ticked the opt-in on the consent screen. The rules live in `src/lib/oauth/step-up.ts` and are covered by `step-up.test.ts`.

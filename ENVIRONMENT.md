# Environment variables

## Deploy to Vercel (GitHub)

1. Import the GitHub repo in Vercel. Framework preset: **Other**. Build command: `vite build` (default `bun run build` works). Output: leave empty — the build writes `.vercel/output` itself (Vercel server preset is selected automatically when `VERCEL` is set).
2. Paste every variable from *Required on Vercel* below, plus the optional groups you use, in Vercel → Settings → Environment Variables (Production and Preview).
3. Before each release with new `db/NN_*.sql` files, run once from your machine: `MIGRATION_URL=<owner url> bun scripts/migrate.ts`.
4. Point each OAuth provider's callback to `<BETTER_AUTH_URL>/api/auth/callback/<provider>`.
5. Cron jobs call `/api/public/cron/*` with the `LOVABLE_CRON_SECRET` bearer token.

`NODE_ENV` is set by Vercel; never set it yourself.

## Required on Vercel

- `DATABASE_URL` — Neon connection as the least-privilege `rout_app` role (pooled endpoint). Never the owner role.
- `BETTER_AUTH_SECRET` — Signs sessions. 32+ random characters, identical on every deploy (changing it signs everyone out).
- `BETTER_AUTH_URL` — Public base URL, e.g. https://rout.be (no trailing slash).
- `NEXT_PUBLIC_APP_URL` — Same public URL; used for auth callbacks and links in emails.
- `PUBLIC_SITE_URL` — Public URL used in share links and metadata.
- `PUBLIC_ORIGIN` — Allowed origin for requests, normally the same URL.

## Database (not on Vercel)

- `MIGRATION_URL` — See below. Only for `bun scripts/migrate.ts`.

## Secrets (32+ random characters each)

- `APP_SESSION_SECRET` — Server-only random secret.
- `SESSION_SECRET` — Server-only random secret.
- `OAUTH_STATE_SECRET` — Server-only random secret.
- `MASTODON_STATE_SECRET` — Server-only random secret.
- `NEON_AUTH_COOKIE_SECRET` — Server-only random secret.
- `BOOKING_TOKEN_SECRET` — Server-only random secret.
- `GO_LINK_SECRET` — Server-only random secret.
- `ALTCHA_HMAC_KEY` — Server-only random secret.
- `CONTACT_HASH_SALT` — Server-only random secret.
- `BOOKING_HMAC_KEY` — Server-only random secret; hashes external calendar event ids (booking engine).
- `ADMIN_BOOTSTRAP_TOKEN` — Server-only random secret.
- `LOVABLE_CRON_SECRET` — Server-only random secret.
- `CRON_SECRET` — Optional alias for `LOVABLE_CRON_SECRET` (asset cleanup accepts `?token=`).
- `TELEGRAM_BOT_TOKEN` — Server-only BotFather token for the phone-verification bot (`/api/public/telegram/webhook`).

## Sign-in providers (optional; tile shows a notice when missing)

- `GOOGLE_CLIENT_ID` — OAuth app credential.
- `GOOGLE_CLIENT_SECRET` — OAuth app credential.
- `APPLE_CLIENT_ID` — OAuth app credential.
- `APPLE_CLIENT_SECRET` — OAuth app credential.
- `APPLE_APP_BUNDLE_IDENTIFIER` — OAuth app credential.
- `GITHUB_CLIENT_ID` — OAuth app credential.
- `GITHUB_CLIENT_SECRET` — OAuth app credential.
- `GITHUB_TOKEN` (alias `GITHUB_PUBLIC_TOKEN`) — optional server-side token so keyless GitHub profile cards avoid rate limits.
- `GITLAB_CLIENT_ID` — OAuth app credential.
- `GITLAB_CLIENT_SECRET` — OAuth app credential.
- `INFOMANIAK_CLIENT_ID` — OAuth app credential.
- `INFOMANIAK_CLIENT_SECRET` — OAuth app credential.
- `PROTON_CLIENT_ID`, `PROTON_CLIENT_SECRET`, `PROTON_DISCOVERY_URL` — Proton OIDC (scopes openid profile email); callback `/api/auth/oauth2/callback/proton`. Proton offers no public OIDC for third parties yet; stays inactive until all three are set.
- `OIDC_CLIENT_ID` — External Keycloak-compatible provider credential (optional).
- `OIDC_CLIENT_SECRET` — External Keycloak-compatible provider credential (optional).
- `OIDC_DISCOVERY_URL` — External Keycloak-compatible provider credential (optional). Without all three, "ROUT ID" uses our own native OIDC provider (`/.well-known/openid-configuration`, first-party PKCE client `rout_native_self`, db/78) — no external keys needed.

## Login via ROUT (provider role)

- `ROUT_CLIENT_ID` — ROUT as identity provider.
- `ROUT_CLIENT_SECRET` — ROUT as identity provider.
- `ROUT_API_KEY` — ROUT as identity provider.

## File storage (Scaleway)

- `SCALEWAY_ACCESS_KEY` — Scaleway Object Storage.
- `SCALEWAY_SECRET_KEY` — Scaleway Object Storage.
- `SCALEWAY_ENDPOINT` — Scaleway Object Storage.
- `SCALEWAY_REGION` — Scaleway Object Storage.
- `SCALEWAY_DEFAULT_BUCKET` — Scaleway Object Storage.
- `SCALEWAY_CLIENT_BUCKET` — Member profile photos and uploaded media.
- `SCALEWAY_INTERNAL_BUCKET` — ROUT-owned assets; never member uploads.

## Email

- `BREVO_API_KEY` — Transactional email / forwarding.
- `BREVO_SENDER_EMAIL` — Transactional email / forwarding.
- `BREVO_SENDER_NAME` — Transactional email / forwarding.
- `BREVO_REPLY_TO_EMAIL` — Transactional email / forwarding.
- `BREVO_ADMIN_EMAIL` — Transactional email / forwarding.
- `BREVO_SMS_SENDER` — Transactional email / forwarding.
- `EMAIL_FROM` — Transactional email / forwarding.
- `IMPROVMX_API_KEY` — Transactional email / forwarding.
- `CONTACT_ADMIN_EMAIL` — Transactional email / forwarding.
- `ADMIN_EMAIL` — Transactional email / forwarding.
- `OWNER_EMAILS` — Transactional email / forwarding.

## Payments

- `STRIPE_SECRET_KEY` — Payments and payouts.
- `STRIPE_PUBLISHABLE_KEY` — Payments and payouts.
- `STRIPE_WEBHOOK_SECRET` — Payments and payouts.
- `BUNQ_API_KEY` — Payments and payouts.
- `BUNQ_ENV` — Payments and payouts.
- `BUNQ_OAUTH_CLIENT_ID` — Payments and payouts.
- `BUNQ_OAUTH_CLIENT_SECRET` — Payments and payouts.
- `BUNQ_PRIVATE_KEY` — Payments and payouts.
- `BUNQ_PUBLIC_KEY` — Payments and payouts.
- `BANKING_WEBHOOK_SECRET` — Payments and payouts.
- `BANKING_WEBHOOK_HMAC_SECRET` — Payments and payouts.
- `PAYMENT_BENEFICIARY` — Payments and payouts.
- `PIX_KEY` — Payments and payouts.
- `PIX_CITY` — Payments and payouts.
- `UPI_VPA` — Payments and payouts.
- `PROMO_CODES` — Payments and payouts.

## Company details (invoices)

- `ROUT_COMPANY_NAME` — Shown on invoices.
- `ROUT_COMPANY_ADDRESS` — Shown on invoices.
- `ROUT_VAT_NUMBER` — Shown on invoices.
- `ROUT_BILLING_EMAIL` — Shown on invoices.

## Notifications

- `KCHAT_WEBHOOK_URL` — kChat alerts.
- `KCHAT_USERNAME` — kChat alerts.

## Details

## PSP_ENCRYPTION_KEY
Server-only. AES-256-GCM key material for creator PSP secrets (`psp_credentials`). At least 32 random characters.

## MIGRATION_URL
Owner connection to Neon, used only by `bun scripts/migrate.ts` (never at runtime). Must differ from DATABASE_URL (rout_app). Not needed on Vercel.

## GITLAB_ISSUER
Optional GitLab server URL (default https://gitlab.com, no trailing slash). Set for self-managed GitLab.

## GITLAB_REDIRECT_URI
Optional. Defaults to <BETTER_AUTH_URL>/api/auth/callback/gitlab (e.g. https://rout.be/api/auth/callback/gitlab). Must match the GitLab application exactly.

## OAUTH_CLIENT_SECRET_PEPPER
Optional, server-only, 32+ random characters. Pepper for "Login met ROUT" client-secret hashes. Falls back to the auth secret. Changing it invalidates every app secret created since (rotate them in the console).

## SMS_PROVIDER
Optional: `android-gateway` (default), `twilio` or `brevo`. Without the keys below, phone verification shows "not configured" and sends nothing.

## SMS_API_KEY
Server-only. Android gateway bearer token, Brevo API key, or Twilio `<AccountSID>:<AuthToken>`.

## SMS_SENDER_ID
Sender name or number (required for Twilio and Brevo).

## SMS_GATEWAY_URL
sms-gate.app base URL, e.g. `https://api.sms-gate.app` (cloud). `/3rdparty/v1/message` is appended; body `{phoneNumbers, textMessage:{text}, deviceId}`.

## SMS_GATEWAY_USER / SMS_GATEWAY_PASSWORD / SMS_GATEWAY_DEVICE_ID
Server-only. Cloud-server username/password and device id from the SMS Gateway Android app (basic auth).

## SMS_ALLOW_INTERNATIONAL
Optional `true`: also send outbound SMS to non-Belgian numbers (default: only +32; others verify via Telegram/inbound SMS).

## SMS_INBOUND_TOKEN
Server-only random token; set the sms-gate.app `sms:received` webhook to `https://rout.be/api/public/sms/inbound?token=<value>`.

## PHONE_ENCRYPTION_KEY
Server-only, 32+ random characters. Encrypts stored phone numbers (AES-GCM) and hashes codes.

## SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
Live Presence (Studio → Verbindingen & Integraties). Create an app at developer.spotify.com/dashboard and add the redirect URI `<PUBLIC_SITE_URL>/api/public/spotify/callback`. Needs `PSP_ENCRYPTION_KEY` too (tokens are encrypted).

## Identity verification (KYC)
- `IDENTITY_HASH_PEPPER` — Server-only random secret used to HMAC provider person IDs into `unique_human_id`. Never rotate after launch (would break the 1-person rule).
- `W_IDENTITY_ISSUER`, `W_IDENTITY_CLIENT_ID`, `W_IDENTITY_CLIENT_SECRET` — W Identity OIDC client. Redirect URI: `https://rout.be/api/public/identity/w-callback`.
- `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET` — Didit passport scan. Webhook URL: `https://rout.be/api/public/identity/didit-webhook`. Max 500 successful scans per month.

## Cron schedule
`vercel.json` schedules `/api/public/cron/cleanup-assets` (daily, removes expired `user_assets` and `shared_files` from storage and database), plus expired ALTCHA rows, security codes and the DNS check — one daily job, since Vercel Hobby allows only one. Codes are also purged lazily on issue, ALTCHA on ~5% of challenges, and integration statuses refresh on visit (stale-while-revalidate). Vercel sends `Authorization: Bearer $CRON_SECRET`. On other hosts call the same URLs from any scheduler with that header.

## Telegram
Register the webhook once with `TELEGRAM_BOT_TOKEN=... bun scripts/telegram-set-webhook.ts https://rout.be` (secret token is derived from the bot token).

- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — Generic aliases for the Scaleway variables above (used when the SCALEWAY_* name is unset). Badge/crest uploads go here, public-read.

## Snapchat (Snap Kit)

- `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET` — Snap Kit Login Kit + Bitmoji Kit. Redirect URI is fixed to `https://rout.be/api/public/snapchat/callback` (from `SITE_ORIGIN`, never the request host); register exactly that in Snap Kit. No location/Snap Map is ever used.

## Deployment mode (admin split)

- `VITE_APP_MODE` — `public` on rout.be (all /admin pages, /api/admin and admin server functions return 404/403), `admin` on rout.dlp.li (only portal + sign-in, no social login, noindex). Unset = everything served (preview).
- `APP_MODE` — Optional server-side override of the same value.

## VITE_PUBLIC_SITE_URL
Public site base URL (e.g. https://rout.be) used for stamp claim links created on the admin portal. Optional; defaults to https://rout.be in admin mode.

## YouTube vault
Reuses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `PSP_ENCRYPTION_KEY`. Add redirect URI `https://rout.be/api/public/youtube/callback` in Google Cloud and enable YouTube Data API v3.

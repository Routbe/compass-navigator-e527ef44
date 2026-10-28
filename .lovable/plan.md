# Make ROUT production-ready: database, settings, workspace conversion

## What we found
- No database is linked to this project. The only key present is the Lovable one: no `DATABASE_URL`, no Neon connection, no auth, Stripe or S3 keys. So no migration can run yet, and `db/103_workspace_conversion.sql` has not been applied anywhere we can reach.
- Workspace conversion emails go through `sendLocalizedEmail`, which uses static Brevo template IDs. It doesn't use Lovable app emails, so the new templates follow the Brevo pattern.
- The Stripe customer ID is copied from `users.app_metadata.stripe_customer_id` into `workspaces.stripe_customer_id` when the workspace is created.

## Step 1: Database (blocked until you link Neon)
1. Open the Neon connect card so you can link your Neon database. Preview then goes through the connector, as `src/lib/neon.ts` already expects.
2. Read `schema_migrations` to see which `db/NN_*.sql` files are still open.
3. Run `bun scripts/migrate-gateway.ts`, then confirm that 103 is recorded and that `workspaces.stripe_customer_id`, `legacy_user_id` and the transfer and sunset tables exist.
4. Smoke test `hasDatabase()` and one read and one write. Report any runtime errors with a fix.

## Step 2: Settings and keys
- Generate the app-owned random secrets (`BETTER_AUTH_SECRET`, `APP_SESSION_SECRET`, `SESSION_SECRET`, `OAUTH_STATE_SECRET`, `BOOKING_TOKEN_SECRET`, `GO_LINK_SECRET`, `ALTCHA_HMAC_KEY`, `CONTACT_HASH_SALT`, `LOVABLE_CRON_SECRET` and the like) instead of asking you for them. Note: production on Vercel keeps its own values, and changing `BETTER_AUTH_SECRET` there signs everyone out.
- Set the config values `BETTER_AUTH_URL`, `PUBLIC_SITE_URL` and `PUBLIC_ORIGIN` to the preview URL.
- Request the provider keys you have to supply, through the secure form, one group at a time. Before each form I'll say where to find each key:
  - Stripe: secret key and webhook secret.
  - Scaleway S3: access key, secret key, bucket and region.
  - Brevo or email.
  - Google, Apple and other sign-in providers.
  - Optional: Telegram, Didit, Spotify and YouTube.
- Keep `ENVIRONMENT.md` and `.env.example` in line with any new names.

## Step 3: Finish workspace conversion
1. Two dedicated emails:
   - Owner Transfer Invite, with an explanation and a `/workspace-transfer/<token>` button.
   - Workspace Member Onboarding.
   Both get i18n text in the existing locale bundles (nl, fr, en, de, as in the existing bundles), a static template ID per language, and a sync through `scripts/sync-brevo-templates.ts`. Sending stays non-blocking.
2. Stripe migration:
   - Move subscriptions and payment methods with the customer. A Stripe customer keeps its subscriptions, so we keep the same customer ID instead of creating a new one.
   - Set `metadata.workspace_id` on the customer in Stripe.
   - Clear the user's `app_metadata.stripe_customer_id` only after the workspace has it, so there is never double billing.
   - PRO checks read the workspace subscription during and after sunset.
   - Webhook handler: look up the customer on `workspaces` first, then on `users`.
   - Rules tests: no second customer, PRO stays active.
3. Personal profile: confirm in the code what happens to `profiles`. If nothing is left over, create a clean default personal profile with a free handle (no links or badges) inside the same transaction. Add a test for that rule.

## Step 4: Testing
- `bunx vitest run`: all tests, including `workspace-conversion-rules.test.ts`. Fix any failures.
- Playwright with a real test account (Better Auth session, `rout_session`):
  - Settings → Account status → wizard and checklist.
  - 6-digit code: wrong code, then the right one.
  - Sunset overlay, by shifting the date with a test query on a test account.
  - `/workspace-transfer/<token>` with an existing account and with a new account.
  - Clean up the test data afterwards.
- Stripe only in test mode.

## Rules we keep
- All rights checks run on the server (`createServerFn` + session).
- No Supabase client.
- Only Tailwind v4 semantic tokens.
- Neon only through `src/lib/neon.ts`.

## Blockers
- Step 1 and everything after it can't start until Neon is linked.
- Live Stripe, S3, email and sign-in checks need your keys.

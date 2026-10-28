# Convert a personal account into a Workspace

This combines both uploaded documents into one flow: a person who made an account for their business turns it into a Workspace owned by a real person's account. Nothing is lost along the way, and the old login is phased out over 30 days.

## What the user sees

1. **Settings → "Turn this account into a Workspace"**
2. **Overview first:** what moves over (links, QR codes, custom domains, apps/OAuth clients, API keys, badges, active subscriptions), plus a warning that the blue verification badge goes away.
3. **Choose the owner:** an email address or user ID of another person's account. If that account doesn't exist yet, we send an invite: "Create your personal ROUT account to become the owner of [Workspace]".
4. **Confirm with a code:** a 6-digit code goes to the current account's email.
5. **Owner accepts:** the owner gets a notification or email and accepts. If they sign up through the invite, the transfer starts right after their signup.
6. **Done:** the owner manages the Workspace through the workspace switcher.
7. **Old login (30 days):** a full-screen notice that can't be closed: "This is now a Workspace. Sign in with your personal account. This sign-in method expires on [date]." After 30 days the old login is deleted, so the email address is free to use again, for example as the Workspace's billing or contact email.

## Rules

- Companies never have their own login. People sign in, and workspaces are entities.
- Both sides must agree (code confirmed + owner accepted) before anything moves.
- Everything moves in one go. If any part fails, nothing changes.
- The blue badge is removed. The Workspace gets no badge until it buys the black B2B badge.
- Billing continues without interruption. The customer, name and VAT number stay the same.
- Running it twice does no harm: a second attempt does nothing.

## Technical details

- **New migration `db/1xx_workspace_conversion.sql`** (idempotent, granted to `rout_app`):
  - `workspace_transfers` (id, source_user_id, target_user_id nullable, target_email, token hash, otp_verified_at, accepted_at, status `pending|otp_ok|accepted|completed|cancelled|expired`, expires_at).
  - Add `workspace_id` to the tables that hold assets: profiles/hub, links, QR codes, domains, analytics, API keys (`oauth_clients` and `custom_badges` already have it).
  - On `workspaces`: add `stripe_customer_id`, `billing_name`, `vat_number`.
  - On `users`: add `account_status` (`active|migrated_sunset`), `sunset_at`, and `migrated_to_workspace_id`.
- **Server** `src/lib/workspace-conversion.server.ts` + `.functions.ts`:
  - `preflight()` — counts per asset type in one read.
  - `startConversion(target)` — creates the transfer, sends the OTP (reusing the existing login-code / email-code mechanism), and sends an invite or notification through `sendLocalizedEmail`.
  - `verifyOtp`, `acceptTransfer(token)` — the second one requires a verified email on the target account.
  - `executeConversion` — one PostgreSQL transaction with row locks: create the workspace, make the target the owner, repoint all foreign keys `user_id → workspace_id`, remove the blue badge, move the Stripe customer, set the user to `migrated_sunset` and `sunset_at = now() + 30d`, and mark the transfer completed. Any error rolls everything back. Guarded by the transfer status, so it runs only once.
  - Hook after signup: open transfers for that email trigger `acceptTransfer` once the email is verified.
- **Stripe:** we don't store a customer ID anywhere yet. When the old account has one, it moves to the workspace and its metadata gets updated through the Stripe API. The subscription itself stays untouched.
- **Sunset block:** server middleware refuses any write for `migrated_sunset` users. The overlay is only the visible side.
- **Scrubber:** `/api/public/cron/sunset-scrubber` (with the `LOVABLE_CRON_SECRET` bearer) hard-deletes auth records past their sunset date, plus their sessions and passkeys. The Workspace's data stays.
- **UI:** a new settings section with steps (overview → owner → code → waiting → done), the accept page `/workspace-transfer/$token`, and the overlay in the app shell. Texts go through the existing language bundles.
- **Tests:** rules in `workspace-rules.ts` (badge stripping, sunset = +30 days, both confirmations required, idempotent).

## Prerequisite

The database connection (`DATABASE_URL`) needs to be set to run the migration and test the flow end to end. Without it, I can build the code but can't verify it.

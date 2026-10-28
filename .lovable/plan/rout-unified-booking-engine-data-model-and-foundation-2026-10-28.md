# ROUT Unified Booking Engine: data model and foundation

Scope of this round: schemas, tables, TypeScript/Zod types, plus the core rules with tests (slot locking, availability bitmaps, routing). No UI yet. The model is presented for approval before the UI is built.

## Choices that differ from the brief
- **No Prisma.** The project uses idempotent `db/NN_*.sql` files through the Neon gateway. Prisma would be a second migration system, so it stays SQL plus Zod.
- **No Redis.** The pre-computed availability lives in Postgres as one bitmap row per person per day (`bit(96)`, 15-minute resolution, UTC). Bitwise AND then runs natively in SQL (`a & b`), and there is no extra service to host.
- **Advisory locks live inside a single gateway batch** (one transaction). An HTTP request cannot hold a lock across requests, so lock, check and insert must run in one batch. An exclusion constraint on the time range is the last line of defence: even without the lock, Postgres refuses an overlap.

## Database (db/104_booking_engine.sql)

```text
booking_event_types      owner: user_id XOR workspace_id (check constraint)
  slug, title, duration_minutes, buffer_before/after_minutes,
  minimum_notice_hours, max_days_ahead, slot_step_minutes,
  confirmation_mode ('instant'|'request'),
  price_cents, currency, stripe_price_id (null = free),
  routing_strategy ('STRICT'|'ROUND_ROBIN'|'COLLECTIVE', only for workspace),
  location_kind ('video'|'address'|'phone'), location_value, is_active
booking_event_type_hosts event_type_id, user_id, priority
availability_rules       user_id, weekday, start_minute, end_minute, timezone (IANA, only for converting rules)
availability_overrides   user_id, date range UTC, kind ('free'|'busy')
connected_calendars      user_id, adapter ('google'|'microsoft'|'caldav'|'ics'),
  sealed credentials (secretbox: tokens, CalDAV password, secret .ics URL),
  sync_cursor/etag, webhook_channel_id, webhook_expires_at,
  last_synced_at, sync_status, last_error_code
calendar_events          ONLY: id, calendar_id, provider_id (hash), start_utc, end_utc, is_blocking
                         unique(calendar_id, provider_id); no title, description or attendees
availability_cache       user_id, day (date UTC), free_bits bit(96), computed_at, version
                         primary key (user_id, day)
bookings                 event_type_id, host_user_id, workspace_id, start_utc, end_utc,
  span tstzrange generated, status ('held'|'pending_payment'|'requested'|'confirmed'|'declined'|'cancelled'),
  guest_name, guest_email, guest_timezone, guest_note,
  stripe_checkout_session_id, hold_expires_at, ics_uid, sequence
  EXCLUDE USING gist (host_user_id WITH =, span WITH &&) WHERE status is active
availability_jobs        user_id, reason, run_after, attempts (debounced recompute queue)
```

- All times are `timestamptz` and are written in UTC. Timezones exist only as an IANA name for rules and for the guest, and conversion happens in the UI or API layer.
- Indexes on (`host_user_id`, `start_utc`) and (`calendar_id`, `start_utc`), plus a partial index on active bookings.
- Server-side access only (`service_role` grants), following the existing pattern.

## Concurrency (book a slot)

One batch, one transaction:
1. `pg_advisory_xact_lock(hashtextextended(host_user_id || slot_start_utc, 0))`
2. Check against `bookings`, `calendar_events` (`is_blocking`) and the buffers.
3. Insert with status `confirmed` (instant), `requested` (request) or `pending_payment`. Paid slots get a 15-minute hold.

The losing request gets a unique or exclusion error, which is translated to `slot_taken`, and the visitor sees "Dit slot is zojuist geboekt."

## Calendar adapters (zero-knowledge)

- One interface: `CalendarAdapter.fetchBusy(window) -> {providerId, startUtc, endUtc, isBlocking}[]`.
- The mapper drops every other field before anything touches the database, and a test enforces this.
- The external `provider_id` is stored as an HMAC hash, so the original ID never ends up in our data.
- The adapters:
  - **Google and Microsoft:** freeBusy/calendarView with the minimum scopes, and webhooks under `/api/public/calendar/{google|microsoft}`, verified via channel token or clientState.
  - **CalDAV:** a REPORT time-range query. Only VEVENT DTSTART/DTEND/TRANSP are parsed.
  - **ICS:** a cron route `/api/public/cron/sync-ics` (bearer `LOVABLE_CRON_SECRET`). It fetches only https, applies the `isPublicHost` check against SSRF, and enforces a size limit.
- This round builds the interface plus the ICS and CalDAV parsers. The Google and Microsoft OAuth apps come later, once their keys are available.

## Pre-computed availability

- Triggers are: a webhook, a sync, a booking change, or a rule change. Each one puts a row in `availability_jobs` (debounced).
- A worker (`/api/public/cron/availability`) computes 30 days of `free_bits`.
- Visitors read only `availability_cache` plus the event-type rules. Notice and buffer are applied in a cheap, pure function over the bits.
- Booking re-validates live inside the lock, so a stale cache can never cause a double booking.

## Workspace routing

- **STRICT:** the fixed host.
- **ROUND_ROBIN:**
  - Take the hosts who are free on the slot.
  - Pick the one with the fewest active bookings this calendar month (UTC), tie-broken by priority and then by id.
  - The pick is decided inside the lock.
- **COLLECTIVE:**
  - Free time is the bitwise AND of all hosts' `free_bits`, in SQL using `bit_and(free_bits)`.
  - The booking creates one row per host in the same transaction.

## Stripe and ICS

- **Paid booking:** a Stripe Checkout session with `metadata.booking_id`. The existing webhook confirms or releases the booking, and an expired hold is released by the cron.
- **ICS:** generated in code (RFC 5545):
  - A fixed `UID`, a `SEQUENCE` that increases on changes, and times in UTC (`Z`).
  - The location or video link.
  - `METHOD:REQUEST`, or `CANCEL` on cancellation.
- **Email:** sent through the existing `sendMail` with `attachments`, non-blocking. The confirmation email is localized like the workspace mails.

## Files
- `db/104_booking_engine.sql`
- `src/lib/booking-engine/types.ts`: Zod schemas and TS interfaces.
- `src/lib/booking-engine/bitmap.ts`: slot bitmaps, AND/OR, notice and buffer.
- `src/lib/booking-engine/routing.ts`
- `src/lib/booking-engine/ics.ts`
- `src/lib/booking-engine/adapters/{types,ics,caldav}.ts`
- `src/lib/booking-engine/book.server.ts`: the lock transaction.
- `src/lib/booking-engine/recompute.server.ts`
- Tests for:
  - bitmap and timezone conversion, including DST in Europe/Brussels;
  - routing (fewest bookings, ties, collective AND);
  - ICS output;
  - the PII filter in the adapters;
  - the `slot_taken` mapping.
- The existing `booking_requests` table stays untouched. Migrating it is a later step.
- One rule in `src/lib/AGENTS.md` (UTC-only, zero-knowledge events, lock plus exclusion).

## Verification
- Apply the migration through `migrate-gateway`.
- Run two simultaneous booking batches against Neon on a test event type; exactly one must succeed. Clean up the test data afterwards.
- `bunx vitest run` for the new tests.

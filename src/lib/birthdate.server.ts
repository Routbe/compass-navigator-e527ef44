import { runSchemaEnsure } from "@/lib/db/schema-ensure.server";
import { sql } from "@/lib/neon";

/** Geboortedatum per account. Alleen via deze helpers lezen/schrijven. */

export const MIN_AGE = 13;

let ready: Promise<void> | null = null;
async function ensureTable() {
  ready ??= runSchemaEnsure(async () => {
    await sql`
      create table if not exists public.user_birthdates (
        user_id uuid primary key references public.users(id) on delete cascade,
        birthdate date not null,
        source text not null default 'user',
        updated_at timestamptz not null default now()
      )`;
  }, "birthdate.server.ts").catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

/** Valideert JJJJ-MM-DD: bestaande datum, niet in de toekomst, minstens 13 jaar. */
export function validateBirthdate(raw: string, now = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("Gebruik een geldige datum.");
  const d = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) throw new Error("Gebruik een geldige datum.");
  if (d.getUTCFullYear() < 1900) throw new Error("Gebruik een geldige datum.");
  const limit = new Date(Date.UTC(now.getUTCFullYear() - MIN_AGE, now.getUTCMonth(), now.getUTCDate()));
  if (d > limit) throw new Error(`Je moet minstens ${MIN_AGE} jaar zijn.`);
  return raw;
}

export async function hasBirthdate(userId: string): Promise<boolean> {
  await ensureTable();
  const rows = (await sql`select 1 from public.user_birthdates where user_id = ${userId} limit 1`) as unknown[];
  return rows.length > 0;
}

export async function saveBirthdate(userId: string, birthdate: string, source: "user" | "google" = "user") {
  await ensureTable();
  const value = validateBirthdate(birthdate);
  await sql`
    insert into public.user_birthdates (user_id, birthdate, source)
    values (${userId}, ${value}, ${source})
    on conflict (user_id) do update
      set birthdate = excluded.birthdate, source = excluded.source, updated_at = now()`;
}

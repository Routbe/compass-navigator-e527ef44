/**
 * Applies db/NN_*.sql in order with the OWNER connection (MIGRATION_URL).
 * Each file runs once, inside a transaction, tracked in public.schema_migrations.
 *
 *   bun scripts/migrate.ts                  apply pending files
 *   bun scripts/migrate.ts --baseline=52    mark 00..52 as applied without running
 *   bun scripts/migrate.ts --dry-run        list pending files
 *
 * Refuses to run without MIGRATION_URL or when it equals DATABASE_URL (the
 * runtime role must never be used for DDL, and vice versa).
 */
import { Pool } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env["MIGRATION_URL"];
if (!url) {
  console.error("MIGRATION_URL ontbreekt (owner-verbinding, direct endpoint).");
  process.exit(1);
}
if (process.env["DATABASE_URL"] && process.env["DATABASE_URL"] === url) {
  console.error("MIGRATION_URL is gelijk aan DATABASE_URL — gebruik de owner-rol voor migraties en rout_app voor de app.");
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const baseline = Number(args.find((a) => a.startsWith("--baseline="))?.split("=")[1] ?? NaN);

const dir = join(import.meta.dir, "..", "db");
const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const pool = new Pool({ connectionString: url });

try {
  await pool.query(`create table if not exists public.schema_migrations (
    filename text primary key, checksum text not null, applied_at timestamptz not null default now())`);
  await pool.query(`revoke all on public.schema_migrations from rout_app`).catch(() => undefined);
  const done = new Map(
    (await pool.query<{ filename: string; checksum: string }>(`select filename, checksum from public.schema_migrations`)).rows.map(
      (r) => [r.filename, r.checksum],
    ),
  );

  for (const file of files) {
    const body = readFileSync(join(dir, file), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    if (done.has(file)) {
      if (done.get(file) !== checksum) console.warn(`! ${file} is gewijzigd na toepassen (niet opnieuw gedraaid).`);
      continue;
    }
    const num = Number(file.split("_")[0]);
    if (Number.isFinite(baseline) && num <= baseline) {
      if (!dryRun) await pool.query(`insert into public.schema_migrations (filename, checksum) values ($1, $2)`, [file, checksum]);
      console.log(`= baseline ${file}`);
      continue;
    }
    if (dryRun) {
      console.log(`… pending ${file}`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(body);
      await client.query(`insert into public.schema_migrations (filename, checksum) values ($1, $2)`, [file, checksum]);
      await client.query("commit");
      console.log(`✓ ${file}`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      console.error(`✗ ${file}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
      break;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}

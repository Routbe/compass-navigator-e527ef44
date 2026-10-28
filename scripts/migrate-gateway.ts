/**
 * Applies pending db/NN_*.sql files through the Lovable Neon connector gateway
 * (LOVABLE_API_KEY + NEON_API_KEY), tracked in public.schema_migrations.
 * Each file is sent as one batch statement => one transaction.
 *
 *   bun scripts/migrate-gateway.ts            apply pending
 *   bun scripts/migrate-gateway.ts --dry-run  list pending
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const URL_ = "https://connector-gateway.lovable.dev/neon/sql";
async function q(body: unknown): Promise<any> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env["LOVABLE_API_KEY"]}`,
      "X-Connection-Api-Key": process.env["NEON_API_KEY"] ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

/** Split on top-level semicolons, respecting $$-quoted bodies, strings and -- comments. */
export function splitSql(src: string): string[] {
  const out: string[] = [];
  let cur = "", i = 0, dollar = false, str = false;
  while (i < src.length) {
    const c = src[i]!, two = src.slice(i, i + 2);
    if (!dollar && !str && two === "--") { const e = src.indexOf("\n", i); i = e < 0 ? src.length : e; continue; }
    if (!str && two === "$$") { dollar = !dollar; cur += two; i += 2; continue; }
    if (!dollar && c === "'") str = !str;
    if (!dollar && !str && c === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const dryRun = process.argv.includes("--dry-run");
const dir = join(import.meta.dir, "..", "db");
const files = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
const done = new Set<string>((await q({ query: "select filename from public.schema_migrations", params: [] })).rows.map((r: any) => r.filename));

for (const file of files) {
  if (done.has(file)) continue;
  if (dryRun) { console.log(`… pending ${file}`); continue; }
  const body = readFileSync(join(dir, file), "utf8");
  const checksum = createHash("sha256").update(body).digest("hex");
  try {
    await q({ queries: [
      ...splitSql(body).map((query) => ({ query, params: [] })),
      { query: "insert into public.schema_migrations (filename, checksum) values ($1, $2)", params: [file, checksum] },
    ] });
    console.log(`✓ ${file}`);
  } catch (e) {
    console.error(`✗ ${file}: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    break;
  }
}

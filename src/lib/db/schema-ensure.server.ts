/**
 * Runtime "create table if not exists" safety nets.
 *
 * The live app connects as the least-privilege role `rout_app`, which may not
 * run DDL. Schema changes belong in `db/NN_*.sql` (run with MIGRATION_URL).
 * When a safety net hits a privilege error we assume the migration already
 * created the object and carry on instead of failing the request.
 */
export function isPrivilegeError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (e?.code === "42501") return true;
  return /permission denied|must be owner/i.test(String(e?.message ?? ""));
}

const warned = new Set<string>();

export async function runSchemaEnsure(fn: () => Promise<unknown>, label = "schema"): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (!isPrivilegeError(error)) throw error;
    if (!warned.has(label)) {
      warned.add(label);
      console.info(`[db] ${label}: runtime DDL skipped (least-privilege role); run migrations via MIGRATION_URL.`);
    }
  }
}

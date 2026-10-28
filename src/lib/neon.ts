/**
 * Server-only Neon Postgres access for ROUT, with two transports:
 *
 * 1. Direct: when DATABASE_URL is set (e.g. Vercel/production), queries run
 *    through @neondatabase/serverless against that connection string.
 * 2. Gateway: otherwise queries go through the Lovable Neon connector gateway
 *    (POST /neon/sql) using LOVABLE_API_KEY and NEON_API_KEY (connection key),
 *    read per request inside server handlers.
 *
 * `sql` mimics the @neondatabase/serverless HTTP client surface used across the
 * app: tagged templates, `sql.query(text, params)`, `sql.unsafe(raw)` and
 * `sql.transaction([...])`. One call = one HTTP request (no session state).
 */

import { neon as neonHttp, neonConfig, Pool } from "@neondatabase/serverless";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/neon/sql";

type Row = Record<string, unknown>;
type Statement = { query: string; params: unknown[] };
type GatewayResult = { rows: Row[]; rowCount: number | null; command: string };

/** Direct transport is active only when a real connection string is present. */
function databaseUrl(): string | null {
  const url = process.env["DATABASE_URL"];
  return url && url.trim() ? url : null;
}

/**
 * True when any database transport is configured: DATABASE_URL (Vercel /
 * production) or the Lovable Neon connector (NEON_API_KEY + LOVABLE_API_KEY).
 * Server code must use this instead of checking one transport's variables.
 */
export function hasDatabase(): boolean {
  if (databaseUrl()) return true;
  return Boolean(process.env["NEON_API_KEY"] && process.env["LOVABLE_API_KEY"]);
}

/** Which transport is active — for diagnostics only, never a value. */
export function databaseTransport(): "direct" | "gateway" | "none" {
  if (databaseUrl()) return "direct";
  return hasDatabase() ? "gateway" : "none";
}

let wsReady = false;
/**
 * The pooled (transaction) client needs a WebSocket. Node 22+ / workerd ship one;
 * older Node runtimes do not, so fall back to the `ws` package once.
 */
async function ensureWebSocket(): Promise<void> {
  if (wsReady) return;
  if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined" && !neonConfig.webSocketConstructor) {
    try {
      const mod = (await import("ws")) as unknown as { default?: unknown; WebSocket?: unknown };
      neonConfig.webSocketConstructor = (mod.default ?? mod.WebSocket ?? mod) as never;
    } catch (err) {
      console.error("[neon] no WebSocket available for the pooled connection:", err);
    }
  }
  wsReady = true;
}

let directHttp: ReturnType<typeof neonHttp> | null = null;
function direct(): ReturnType<typeof neonHttp> | null {
  const url = databaseUrl();
  if (!url) return null;
  directHttp ??= neonHttp(url, { fullResults: true });
  return directHttp;
}

let directPool: Pool | null = null;
function pool(): Pool | null {
  const url = databaseUrl();
  if (!url) return null;
  directPool ??= new Pool({ connectionString: url });
  return directPool;
}

function gatewayHeaders(): Record<string, string> {
  const lovable = process.env["LOVABLE_API_KEY"];
  const connection = process.env["NEON_API_KEY"];
  if (!lovable || !connection) {
    throw new Error("No database configured: set DATABASE_URL (Vercel) or link the Neon connector (NEON_API_KEY + LOVABLE_API_KEY).");
  }
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": connection,
    "Content-Type": "application/json",
  };
}

async function post(body: unknown): Promise<any> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = new Error(`Neon ${res.status}${json?.code ? ` ${json.code}` : ""}: ${json?.message ?? text.slice(0, 300)}`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = json?.code;
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Normalise params: objects/arrays of objects go as JSON text for json(b) columns. */
function normaliseParams(params: unknown[]): unknown[] {
  return params.map((p) => (p instanceof Date ? p.toISOString() : p === undefined ? null : p));
}

export async function runQuery(query: string, params: unknown[] = []): Promise<GatewayResult> {
  const client = direct();
  if (client) {
    const result = (await client.query(query, normaliseParams(params))) as unknown as GatewayResult & {
      fields?: { name: string }[];
    };
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? null, command: result.command ?? "" };
  }
  return (await post({ query, params: normaliseParams(params) })) as GatewayResult;
}

export async function runBatch(statements: Statement[]): Promise<GatewayResult[]> {
  const tx = pool();
  if (tx) {
    await ensureWebSocket();
    // Real transaction over the direct connection: all or nothing.
    const client = await tx.connect();
    try {
      await client.query("BEGIN");
      const results: GatewayResult[] = [];
      for (const s of statements) {
        const r = await client.query(s.query, normaliseParams(s.params));
        results.push({ rows: (r.rows ?? []) as Row[], rowCount: r.rowCount ?? null, command: r.command ?? "" });
      }
      await client.query("COMMIT");
      return results;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* connection may already be gone */
      }
      throw err;
    } finally {
      client.release();
    }
  }
  const json = await post({
    queries: statements.map((s) => ({ query: s.query, params: normaliseParams(s.params) })),
  });
  return json.results as GatewayResult[];
}

/** Lazy query: executes when awaited, or as part of `sql.transaction([...])`. */
class LazyQuery implements PromiseLike<Row[]> {
  constructor(readonly statement: Statement) {}
  private exec?: Promise<Row[]>;
  run(): Promise<Row[]> {
    this.exec ??= runQuery(this.statement.query, this.statement.params).then((r) => r.rows);
    return this.exec;
  }
  then<A = Row[], B = never>(
    onfulfilled?: ((value: Row[]) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.run().then(onfulfilled, onrejected);
  }
  /** Promise compatibility: `sql\`...\`.catch()` must work like a real promise. */
  catch<B = never>(onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<Row[] | B> {
    return this.run().catch(onrejected);
  }
  finally(onfinally?: (() => void) | null): Promise<Row[]> {
    return this.run().finally(onfinally);
  }
}

class RawSql {
  constructor(readonly text: string) {}
}

function buildTemplate(strings: TemplateStringsArray, values: unknown[]): Statement {
  let query = "";
  const params: unknown[] = [];
  strings.forEach((chunk, i) => {
    query += chunk;
    if (i < values.length) {
      const v = values[i];
      if (v instanceof RawSql) query += v.text;
      else {
        params.push(v);
        query += `$${params.length}`;
      }
    }
  });
  return { query, params };
}

type SqlTag = {
  (strings: TemplateStringsArray, ...values: unknown[]): LazyQuery & Promise<any[]>;
  query(text: string, params?: unknown[]): LazyQuery & Promise<any[]>;
  unsafe(text: string): any;
  transaction(queries: PromiseLike<unknown>[]): Promise<any[][]>;
};

function makeSql(): SqlTag {
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    new LazyQuery(buildTemplate(strings, values))) as unknown as SqlTag;
  tag.query = (text: string, params: unknown[] = []) => new LazyQuery({ query: text, params }) as never;
  tag.unsafe = (text: string) => new RawSql(text);
  tag.transaction = async (queries) => {
    const statements = queries.map((q) => {
      if (!(q instanceof LazyQuery)) throw new Error("sql.transaction expects queries created by sql`` or sql.query()");
      return q.statement;
    });
    const results = await runBatch(statements);
    return results.map((r) => r.rows);
  };
  return tag;
}

export const sql: SqlTag = makeSql();

/** Drop-in for `neon(url)` from @neondatabase/serverless: the URL is ignored, the active transport is used. */
export function neon(_connectionString?: string): SqlTag {
  return sql;
}

/**
 * Minimal pg.Pool-compatible adapter (query/connect/end) for libraries such as
 * Better Auth's Kysely adapter. With DATABASE_URL a real Pool is used; over the
 * gateway requests are stateless, so BEGIN / COMMIT / ROLLBACK are accepted but
 * do not span requests.
 */
function toPgResult(r: GatewayResult & { fields?: { name: string }[] }) {
  return { rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0), command: r.command, fields: r.fields ?? [] };
}

const TX_NOOP = /^\s*(begin|commit|rollback|start transaction|end)\b/i;

export class GatewayPool {
  async query(text: string | { text: string; values?: unknown[] }, values?: unknown[]) {
    const q = typeof text === "string" ? text : text.text;
    const p = typeof text === "string" ? (values ?? []) : (text.values ?? values ?? []);
    const directPool = pool();
    if (directPool) {
      await ensureWebSocket();
      return directPool.query(q, normaliseParams(p));
    }
    if (TX_NOOP.test(q)) return { rows: [], rowCount: 0, command: "NOOP", fields: [] };
    return toPgResult((await runQuery(q, p)) as never);
  }
  async connect() {
    const directPool = pool();
    if (directPool) {
      await ensureWebSocket();
      return directPool.connect();
    }
    return {
      query: (text: string | { text: string; values?: unknown[] }, values?: unknown[]) => this.query(text, values),
      release: () => undefined,
    };
  }
  async end() {
    /* pools are shared; never closed per-request */
  }
  on() {
    return this;
  }
}

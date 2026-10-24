export type SqlValue = string | number | null | Uint8Array;
export type Row = Record<string, SqlValue>;
/** One statement, run synchronously, all rows back. Blobs are Uint8Array both ways. */
export type Sql = (query: string, ...args: SqlValue[]) => Row[];

/** The bit of DurableObjectStorage we use, so this file needs no Workers types. */
type SqlStorageLike = {
  sql: { exec(query: string, ...args: unknown[]): { toArray(): Record<string, unknown>[] } };
};

/** `ctx.storage.sql` as a `Sql`: DO blobs are ArrayBuffers on the way in and out. */
export function doSql(storage: SqlStorageLike): Sql {
  return (query, ...args) => {
    const bound = args.map(a => (a instanceof Uint8Array ? a.slice().buffer : a));
    return storage.sql.exec(query, ...bound).toArray().map(row => {
      const out: Row = {};
      for (const k in row) {
        const v = row[k];
        out[k] = v instanceof ArrayBuffer ? new Uint8Array(v) : (v as SqlValue);
      }
      return out;
    });
  };
}

import { sql, type SQL } from "drizzle-orm";

/**
 * Many rows, one statement.
 *
 * A write loop issues one round trip per row, and without a transaction a
 * failure half-way leaves the first half applied. `UPDATE … FROM (VALUES …)`
 * does the same work in one statement, which Postgres applies atomically — so
 * a batched write is both one round trip and all-or-nothing.
 *
 *   const layout = valuesTable("layout", { id: "text", x: "integer" }, rows);
 *   db.update(widgets)
 *     .set({ layoutX: layout.column("x") })
 *     .from(layout.from)
 *     .where(eq(widgets.id, layout.column("id")));
 */

/** The Postgres types a VALUES column is cast to. */
export type ValuesColumnType = "text" | "integer" | "boolean" | "timestamptz";

type ValueOf<T extends ValuesColumnType> = T extends "text"
  ? string
  : T extends "integer"
    ? number
    : T extends "boolean"
      ? boolean
      : Date;

/** Postgres refuses a statement with more bind parameters than this. */
const MAX_PARAMETERS = 65_535;

export function valuesTable<const C extends Record<string, ValuesColumnType>>(
  alias: string,
  columns: C,
  rows: ReadonlyArray<{ [K in keyof C]: ValueOf<C[K]> | null }>,
): { from: SQL; column: (name: keyof C & string) => SQL } {
  const names = Object.keys(columns) as Array<keyof C & string>;
  if (rows.length === 0) {
    // `VALUES` with no rows is a syntax error; callers skip the write instead.
    throw new Error("valuesTable needs at least one row");
  }
  if (rows.length * names.length > MAX_PARAMETERS) {
    throw new Error(
      `valuesTable: ${rows.length} rows exceed Postgres's bind parameter limit; write them in chunks`,
    );
  }

  /*
   * Every value is cast explicitly. A bind parameter inside VALUES has no
   * column to infer a type from, so without the cast Postgres types it as
   * text and the assignment to an integer or timestamp column fails.
   */
  const tuples = rows.map(
    (row) =>
      sql`(${sql.join(
        names.map((name) => {
          const value = row[name];
          return sql`${value instanceof Date ? value.toISOString() : value}::${sql.raw(columns[name])}`;
        }),
        sql`, `,
      )})`,
  );

  return {
    from: sql`(values ${sql.join(tuples, sql`, `)}) as ${sql.identifier(alias)}(${sql.join(
      names.map((name) => sql.identifier(name)),
      sql`, `,
    )})`,
    column: (name) => sql`${sql.identifier(alias)}.${sql.identifier(name)}`,
  };
}

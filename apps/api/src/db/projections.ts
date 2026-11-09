/**
 * Snake_case full-row projections for Drizzle selects.
 *
 * The route mappers (mapCharacter*, mapSpell, mapMonster, …) read raw DB rows
 * keyed by column name (snake_case). `select(cols(table))` reproduces exactly
 * that row shape while querying through Drizzle — same keys, same values,
 * mappers untouched. This is the load-bearing convention of the raw-SQL →
 * Drizzle migration: a query rewrite must not change what mappers see.
 */
import { getTableColumns } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

/**
 * A table's columns re-keyed by their DB column name (snake_case) — the exact
 * row shape `select()` produces, so typed results flow to the mappers.
 */
export type ColumnsByDbName<T extends SQLiteTable> = {
  [
    K in keyof T['_']['columns'] & string as T['_']['columns'][K]['_']['name']
  ]: T['_']['columns'][K];
};

export function cols<T extends SQLiteTable>(table: T): ColumnsByDbName<T> {
  const out = {} as ColumnsByDbName<T>;
  for (const column of Object.values(getTableColumns(table))) {
    (out as Record<string, unknown>)[column.name] = column;
  }
  return out;
}

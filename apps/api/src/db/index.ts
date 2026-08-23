/**
 * SQLite connection singleton (better-sqlite3).
 * All weights in the DB are KILOGRAMS.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as DB } from 'better-sqlite3';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Resolve the monorepo root (3 levels up from apps/api/src/db/). */
function monorepoRoot(): string {
  return resolve(__dirname, '..', '..', '..', '..');
}

let dbInstance: DB | null = null;

export function getDbPath(): string {
  const fromEnv = process.env.DATABASE_PATH;
  if (fromEnv) return resolve(monorepoRoot(), fromEnv);
  return resolve(monorepoRoot(), 'data', 'db', 'inventory.sqlite');
}

/**
 * Directory where item illustrations live (data/images/items/<id>.jpg).
 * Env-overridable and repo-root relative like DATABASE_PATH, so test stacks
 * can point it at a throwaway dir.
 */
export function getItemImagesDir(): string {
  const fromEnv = process.env.ITEM_IMAGES_PATH;
  if (fromEnv) return resolve(monorepoRoot(), fromEnv);
  return resolve(monorepoRoot(), 'data', 'images', 'items');
}

export function getDb(): DB {
  if (dbInstance) return dbInstance;

  const dbPath = getDbPath();
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    // ignore — dir may already exist
  }

  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  // Register a normalize() function for accent-insensitive search.
  // Strips diacritics (é→e, è→e, ç→c) and lowercases.
  dbInstance.function('normalize', (text: string | null): string => {
    if (!text) return '';
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  });

  // Test instrumentation: with DB_SQL_TRACE=<file>, record every prepared
  // statement + its callsite. scripts/api-tests/coverage.ts turns the trace
  // into a per-query-site coverage gate (npm run test-api). No-op otherwise.
  const tracePath = process.env.DB_SQL_TRACE;
  if (tracePath) {
    const origPrepare = dbInstance.prepare.bind(dbInstance);
    (dbInstance as any).prepare = (sql: string) => {
      const stack = (new Error().stack ?? '').split('\n');
      // First frame inside app code but outside src/db/ (the wrapper itself,
      // migrateColumns and seed attribute to their caller — fine, they are
      // outside the gate's scope anyway).
      const frame = stack.find((l) => /apps[\\/]api[\\/]src[\\/](?!db[\\/])/.test(l)) ?? '';
      const callsite = (frame.match(/src[\\/].+?:\d+:\d+/) ?? ['unknown'])[0].replace(/\\/g, '/');
      appendFileSync(tracePath, `${callsite}\u0001${sql.replace(/\s+/g, ' ').trim()}\n`);
      return origPrepare(sql);
    };
  }

  return dbInstance;
}

/**
 * ⚠️ FROZEN BASELINE — do not add entries here anymore.
 *
 * schema.sql + this list create the baseline schema on every database
 * (existing and fresh) and keep running on boot, but the schema source of
 * truth for NEW changes is src/db/schema.ts: edit it, run `npm run
 * db:generate` (drizzle-kit), commit the generated apps/api/drizzle/00NN
 * migration — server boot applies it automatically (db/drizzle.ts).
 *
 * Columns that were added to existing tables AFTER their initial creation.
 * `CREATE TABLE IF NOT EXISTS` is a no-op on existing tables, so schema.sql
 * alone cannot add these to an older database. We introspect with PRAGMA
 * table_info() and ALTER TABLE ... ADD COLUMN for any that are missing.
 *
 * Note: SQLite ADD COLUMN cannot use non-constant DEFAULTs or add CHECK
 * constraints — only the type + constant default is included here. The
 * defaults guarantee valid initial values; app-level validation enforces
 * ranges (e.g. exhaustion 0–6) thereafter.
 */
const COLUMN_MIGRATIONS: Record<string, Array<{ name: string; ddl: string }>> = {
  characters: [
    { name: 'capacity_multiplier', ddl: 'REAL NOT NULL DEFAULT 1.0' },
    { name: 'exhaustion', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'conditions', ddl: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'food_days', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'water_days', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'max_hp', ddl: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'current_hp', ddl: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'temp_hp', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    // --- Character sheet (abilities, skills, spells) ---
    { name: 'level', ddl: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'dexterity', ddl: 'INTEGER NOT NULL DEFAULT 10' },
    { name: 'constitution', ddl: 'INTEGER NOT NULL DEFAULT 10' },
    { name: 'intelligence', ddl: 'INTEGER NOT NULL DEFAULT 10' },
    { name: 'wisdom', ddl: 'INTEGER NOT NULL DEFAULT 10' },
    { name: 'charisma', ddl: 'INTEGER NOT NULL DEFAULT 10' },
    { name: 'character_class', ddl: 'TEXT' },
    { name: 'race', ddl: 'TEXT' },
    { name: 'background', ddl: 'TEXT' },
    { name: 'speed', ddl: 'REAL NOT NULL DEFAULT 9' },
    { name: 'skill_proficiencies', ddl: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'skill_expertise', ddl: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'tool_proficiencies', ddl: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'tool_expertise', ddl: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'languages', ddl: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'saving_throw_proficiencies', ddl: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'spell_slots_used', ddl: "TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0]'" },
    // --- Description / personality ---
    { name: 'alignment', ddl: 'TEXT' },
    { name: 'sex', ddl: 'TEXT' },
    { name: 'height', ddl: 'TEXT' },
    { name: 'weight', ddl: 'TEXT' },
    { name: 'age', ddl: 'TEXT' },
    { name: 'skin', ddl: 'TEXT' },
    { name: 'eyes', ddl: 'TEXT' },
    { name: 'hair', ddl: 'TEXT' },
    { name: 'portrait_url', ddl: 'TEXT' },
    { name: 'personality_traits', ddl: 'TEXT' },
    { name: 'ideals', ddl: 'TEXT' },
    { name: 'bonds', ddl: 'TEXT' },
    { name: 'flaws', ddl: 'TEXT' },
    { name: 'appearance', ddl: 'TEXT' },
    { name: 'armor_class_override', ddl: 'INTEGER' },
    { name: 'death_save_successes', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'death_save_failures', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'inspiration', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'concentrating', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'weapon_proficiencies', ddl: 'TEXT' },
    { name: 'fighting_style', ddl: 'TEXT' },
    { name: 'wild_shape_slug', ddl: 'TEXT' },
    { name: 'wild_shape_hp', ddl: 'INTEGER' },
    { name: 'wild_shape_max_hp', ddl: 'INTEGER' },
    { name: 'wild_shape_uses', ddl: 'INTEGER NOT NULL DEFAULT 2' },
    { name: 'hit_dice_used', ddl: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'wild_shape_seen_json', ddl: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'druid_circle', ddl: 'TEXT' },
    { name: 'divine_domain', ddl: 'TEXT' },
    { name: 'land_circle', ddl: 'TEXT' },
    { name: 'sacred_oath', ddl: 'TEXT' },
    // Subclass key (CLASS_SUBCLASSES) for classes without a dedicated column
    { name: 'subclass', ddl: 'TEXT' },
    // Secret character prep: hidden = invisible to other players, inactive in combat
    { name: 'hidden', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  ],
  items: [
    { name: 'survival_tags', ddl: "TEXT NOT NULL DEFAULT '[]'" },
    { name: 'aliases', ddl: 'TEXT' },
  ],
  storage_locations: [
    { name: 'strength', ddl: 'INTEGER DEFAULT 10' },
    { name: 'multiplier', ddl: 'REAL NOT NULL DEFAULT 1.0' },
    { name: 'capacity_kg', ddl: 'REAL' },
    { name: 'own_weight_kg', ddl: 'REAL NOT NULL DEFAULT 0' },
    { name: 'item_id', ddl: 'INTEGER REFERENCES items(id) ON DELETE SET NULL' },
    { name: 'sort_order', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  ],
  inventory: [
    {
      name: 'storage_location_id',
      ddl: 'INTEGER REFERENCES storage_locations(id) ON DELETE SET NULL',
    },
  ],
  character_features: [
    { name: 'counter_max', ddl: 'INTEGER' },
    { name: 'counter_current', ddl: 'INTEGER' },
    // Link to the SRD feature catalog (classFeatures.ts) — powers rest resets
    { name: 'catalog_id', ddl: 'TEXT' },
    // Manual rest recharge for non-catalog traits: 'short' | 'long' | NULL
    { name: 'reset_type', ddl: 'TEXT' },
  ],
  combatants: [
    { name: 'group_id', ddl: 'INTEGER' },
    { name: 'card_color', ddl: 'TEXT' },
  ],
};

/**
 * Backfill missing columns on existing tables.
 * Idempotent: queries PRAGMA table_info() and only ALTERs what's absent.
 */
function migrateColumns(db: DB): void {
  let added = 0;
  for (const [table, columns] of Object.entries(COLUMN_MIGRATIONS)) {
    // table_info returns rows: { cid, name, type, notnull, dflt_value, pk }
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const existing = new Set(rows.map((r) => r.name));
    for (const col of columns) {
      if (existing.has(col.name)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.ddl}`);
      console.log(`[db] added column: ${table}.${col.name}`);
      added++;
    }
  }
  if (added > 0) {
    console.log(`[db] column migration: ${added} column(s) backfilled`);
  }
}

/** Run the schema.sql migration (idempotent) + backfill missing columns. */
export function migrate(): void {
  const db = getDb();
  const schemaPath = resolve(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf8');

  // Run the full schema (CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).
  // On an existing DB, some CREATE INDEX statements may fail if they reference
  // a column that hasn't been backfilled yet — that's fine, we retry after
  // migrateColumns below.
  try {
    db.exec(sql);
  } catch {
    // Re-run statement-by-statement, skipping any that fail (typically a
    // CREATE INDEX on a not-yet-migrated column).
    const stmts = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));
    for (const stmt of stmts) {
      try {
        db.exec(`${stmt};`);
      } catch {
        // skip (likely an index on a column added by migrateColumns)
      }
    }
  }

  migrateColumns(db);

  // Re-run CREATE INDEX statements now that all columns exist.
  const indexStmts = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => /^CREATE\s+INDEX/i.test(s));
  for (const stmt of indexStmts) {
    try {
      db.exec(`${stmt};`);
    } catch {
      // already exists or other benign error
    }
  }

  console.log(`[db] schema applied to ${getDbPath()}`);
}

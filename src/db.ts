import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { config } from "./config";

export type DB = any;

export const FOOD_GROUP_SEEDS = [
  ["food-grain", "主食/谷薯"],
  ["food-vegetable", "蔬菜"],
  ["food-fruit", "水果"],
  ["food-bean", "豆类及豆制品"],
  ["food-mushroom", "菌菇/藻类"],
  ["food-meat", "畜禽肉"],
  ["food-organ", "动物内脏"],
  ["food-seafood", "水产/海鲜"],
  ["food-egg-milk", "蛋奶"],
  ["food-nut", "坚果/种子"],
  ["food-soup", "汤、浓汁及火锅汤底"],
  ["food-other", "零食、调味及其他"],
] as const;

export const RECIPE_GROUP_SEEDS = [
  ["recipe-home", "家常菜"],
  ["recipe-vegetable", "素菜"],
  ["recipe-meat", "畜禽肉菜"],
  ["recipe-seafood", "水产菜"],
  ["recipe-soup", "汤羹"],
  ["recipe-staple", "主食/面点"],
  ["recipe-other", "外食/其他"],
] as const;

const BEVERAGE_SEEDS = [
  ["bev-water", "纯净水", 1],
  ["bev-soda", "无糖苏打水", 0],
  ["bev-green-tea", "淡绿茶", 0],
  ["bev-lemon-water", "无糖柠檬水", 0],
  ["bev-coffee", "黑咖啡/无糖咖啡", 0],
  ["bev-barley-water", "无糖薏仁水", 0],
  ["bev-barley-tea", "无糖大麦茶", 0],
  ["bev-winter-melon-tea", "无糖冬瓜茶", 0],
  ["bev-corn-silk-tea", "无糖玉米须茶", 0],
] as const;

const FOOD_SEEDS = [
  ["food-rice", "普通大米", "米饭,大米", "food-grain", "熟", 34.67],
  ["food-millet", "小米", "", "food-grain", "熟", 20.06],
  ["food-sweet-potato", "甘薯", "红薯,地瓜", "food-grain", "熟", 18.62],
  ["food-carrot", "红萝卜", "胡萝卜", "food-vegetable", "生", 13.23],
  ["food-daikon", "白萝卜", "萝卜", "food-vegetable", "生", 10.98],
  ["food-pineapple", "菠萝", "凤梨", "food-fruit", "可食部", 11.48],
  ["food-pomelo", "柚子", "", "food-fruit", "可食部", 8.37],
  ["food-orange", "橘子", "柑橘", "food-fruit", "可食部", 4.13],
  ["food-soy-milk", "豆浆", "", "food-bean", "熟", 63.17],
  ["food-tofu", "豆腐块", "豆腐", "food-bean", "熟", 68.63],
  ["food-chicken-breast", "鸡胸肉", "鸡肉", "food-meat", "熟", 207.97],
  ["food-pork", "猪肉（后臀尖）", "猪肉", "food-meat", "生", 137.84],
  ["food-chicken-liver", "鸡肝", "", "food-organ", "熟", 317],
  ["food-scallop", "扇贝", "", "food-seafood", "可食部", 193.44],
  ["food-shrimp", "基围虾", "虾", "food-seafood", "熟", 187.4],
  ["food-crab", "河蟹", "螃蟹", "food-seafood", "熟", 147],
  ["food-grass-carp", "草鱼", "", "food-seafood", "熟", 134.44],
  ["food-dried-seaweed", "紫菜（干）", "紫菜", "food-mushroom", "干制", 415.34],
] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  default_urate_unit TEXT NOT NULL DEFAULT 'umol/L' CHECK (default_urate_unit IN ('umol/L', 'mg/dL')),
  water_goal_ml INTEGER,
  session_generation INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trusted_device_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  generation INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  device_label TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON trusted_device_sessions(token_hash);
CREATE TABLE IF NOT EXISTS reference_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  publisher TEXT,
  version TEXT,
  url TEXT,
  file_hash TEXT,
  usage_note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS food_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '',
  group_id TEXT REFERENCES food_groups(id) ON DELETE SET NULL,
  state TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_foods_search ON foods(name, aliases);
CREATE TABLE IF NOT EXISTS food_versions (
  id TEXT PRIMARY KEY,
  food_id TEXT NOT NULL REFERENCES foods(id),
  version_no INTEGER NOT NULL,
  basis_g REAL NOT NULL DEFAULT 100,
  purine_low REAL,
  purine_mean REAL,
  purine_high REAL,
  range_type TEXT NOT NULL,
  source_id TEXT REFERENCES reference_sources(id),
  verification_status TEXT NOT NULL DEFAULT 'PREPARED',
  sample_note TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(food_id, version_no)
);
CREATE TABLE IF NOT EXISTS recipe_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '',
  group_id TEXT REFERENCES recipe_groups(id) ON DELETE SET NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_versions (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id),
  version_no INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('ingredients', 'manual')),
  final_yield_g REAL,
  total_low REAL,
  total_high REAL,
  purine_low REAL,
  purine_high REAL,
  source_id TEXT REFERENCES reference_sources(id),
  verification_status TEXT NOT NULL DEFAULT 'PREPARED',
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(recipe_id, version_no)
);
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id TEXT PRIMARY KEY,
  recipe_version_id TEXT NOT NULL REFERENCES recipe_versions(id) ON DELETE CASCADE,
  food_version_id TEXT NOT NULL REFERENCES food_versions(id),
  grams REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS beverage_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS beverages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '',
  group_id TEXT REFERENCES beverage_groups(id) ON DELETE SET NULL,
  is_plain_water INTEGER NOT NULL DEFAULT 0,
  contains_sugar INTEGER NOT NULL DEFAULT 0,
  system INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS portion_presets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('food', 'recipe', 'beverage')),
  value REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('g', 'mL')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS diet_entries (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('food', 'recipe')),
  food_version_id TEXT REFERENCES food_versions(id),
  recipe_version_id TEXT REFERENCES recipe_versions(id),
  quantity_g REAL NOT NULL,
  item_name_snapshot TEXT NOT NULL,
  group_name_snapshot TEXT,
  reference_low_snapshot REAL,
  reference_high_snapshot REAL,
  reference_basis_g_snapshot REAL,
  calculation_version TEXT NOT NULL,
  contribution_low REAL,
  contribution_high REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK ((kind = 'food' AND food_version_id IS NOT NULL AND recipe_version_id IS NULL) OR (kind = 'recipe' AND recipe_version_id IS NOT NULL AND food_version_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_diet_entries_date ON diet_entries(entry_date, deleted_at);
CREATE TABLE IF NOT EXISTS beverage_entries (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  entry_date TEXT NOT NULL,
  beverage_id TEXT NOT NULL REFERENCES beverages(id),
  beverage_name_snapshot TEXT NOT NULL,
  is_plain_water_snapshot INTEGER NOT NULL DEFAULT 0,
  amount_ml REAL NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_beverage_entries_date ON beverage_entries(entry_date, deleted_at);
CREATE TABLE IF NOT EXISTS urate_measurements (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  measured_date TEXT NOT NULL,
  measured_time TEXT,
  value_original REAL NOT NULL,
  unit_original TEXT NOT NULL CHECK (unit_original IN ('umol/L', 'mg/dL')),
  value_umol_l REAL NOT NULL,
  fasting TEXT CHECK (fasting IN ('fasting', 'non_fasting', 'unknown')),
  source_kind TEXT,
  facility TEXT,
  acute_flare INTEGER,
  reference_low_original REAL,
  reference_high_original REAL,
  reference_unit_original TEXT CHECK (reference_unit_original IN ('umol/L', 'mg/dL')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_urate_date ON urate_measurements(measured_date, deleted_at);
CREATE TABLE IF NOT EXISTS backup_records (
  id TEXT PRIMARY KEY,
  backup_type TEXT NOT NULL,
  file_path TEXT,
  file_size INTEGER,
  sha256 TEXT,
  format_version TEXT NOT NULL,
  encryption_key_version TEXT,
  started_at TEXT,
  completed_at TEXT,
  exit_code INTEGER,
  replica_path TEXT,
  replica_sha256 TEXT,
  replica_status TEXT,
  created_at TEXT NOT NULL,
  verified_at TEXT,
  status TEXT NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  session_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at);
`;

function now() {
  return new Date().toISOString();
}

function insertSeedGroups(db: DB) {
  const timestamp = now();
  const insertFood = db.prepare("INSERT OR IGNORE INTO food_groups (id, name, sort_order, system, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)");
  FOOD_GROUP_SEEDS.forEach(([id, name], index) => insertFood.run(id, name, index, timestamp, timestamp));
  const insertRecipe = db.prepare("INSERT OR IGNORE INTO recipe_groups (id, name, sort_order, system, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)");
  RECIPE_GROUP_SEEDS.forEach(([id, name], index) => insertRecipe.run(id, name, index, timestamp, timestamp));
  db.prepare("INSERT OR IGNORE INTO beverage_groups (id, name, sort_order, system, created_at, updated_at) VALUES ('beverage-system', '系统预置', 0, 1, ?, ?)").run(timestamp, timestamp);
}

function insertSeedBeverages(db: DB) {
  const timestamp = now();
  const insert = db.prepare("INSERT OR IGNORE INTO beverages (id, name, aliases, group_id, is_plain_water, contains_sugar, system, notes, created_at, updated_at) VALUES (?, ?, '', 'beverage-system', ?, 0, 1, '系统预置，不代表医学推荐。', ?, ?)");
  BEVERAGE_SEEDS.forEach(([id, name, plainWater]) => insert.run(id, name, plainWater, timestamp, timestamp));
}

function insertSeedPortions(db: DB) {
  const timestamp = now();
  const insert = db.prepare("INSERT OR IGNORE INTO portion_presets (id, kind, value, unit, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  [50, 100, 150, 200].forEach((value, index) => insert.run(`preset-food-${value}`, "food", value, "g", index, timestamp, timestamp));
  [100, 150, 200, 300].forEach((value, index) => insert.run(`preset-recipe-${value}`, "recipe", value, "g", index, timestamp, timestamp));
  [100, 200, 300, 500, 1000].forEach((value, index) => insert.run(`preset-beverage-${value}`, "beverage", value, "mL", index, timestamp, timestamp));
}

function insertSeedSource(db: DB) {
  const timestamp = now();
  db.prepare("INSERT OR IGNORE INTO reference_sources (id, title, publisher, version, url, usage_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "source-wst-560-2017",
    "WS/T 560—2017 高尿酸血症与痛风患者膳食指导",
    "国家卫生健康委",
    "2017",
    "https://www.nhc.gov.cn/ewebeditor/uploadfile/2018/06/20180613135747350.pdf",
    "示例种子数据来源登记；每条记录仍需逐项复核后才能标记 VERIFIED。",
    timestamp,
  );
  db.prepare("INSERT OR IGNORE INTO reference_sources (id, title, publisher, version, usage_note, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    "source-user-estimate",
    "用户估计（非外部资料）",
    "用户",
    "v1",
    "用于记录没有外部参考值或用户手工范围的条目；不应标记为 VERIFIED。",
    timestamp,
  );
}

function insertSeedFoods(db: DB) {
  const timestamp = now();
  const foodInsert = db.prepare("INSERT OR IGNORE INTO foods (id, name, aliases, group_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const versionInsert = db.prepare("INSERT OR IGNORE INTO food_versions (id, food_id, version_no, basis_g, purine_low, purine_mean, purine_high, range_type, source_id, verification_status, notes, created_at) VALUES (?, ?, 1, 100, ?, ?, ?, 'single_point', 'source-wst-560-2017', 'PREPARED', '规格示例种子，尚未逐项人工复核。', ?)");
  for (const [id, name, aliases, groupId, state, value] of FOOD_SEEDS) {
    foodInsert.run(id, name, aliases, groupId, state, timestamp, timestamp);
    versionInsert.run(`${id}-v1`, id, value, value, value, timestamp);
  }
}

function seed(db: DB) {
  const timestamp = now();
  db.prepare("INSERT OR IGNORE INTO app_settings (id, timezone, default_urate_unit, water_goal_ml, session_generation, created_at, updated_at) VALUES (1, ?, 'umol/L', NULL, 1, ?, ?)").run(config.timezone, timestamp, timestamp);
  insertSeedGroups(db);
  insertSeedBeverages(db);
  insertSeedPortions(db);
  insertSeedSource(db);
  insertSeedFoods(db);
}

function ensureColumn(db: DB, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item: any) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrate(db: DB) {
  ensureColumn(db, "backup_records", "encryption_key_version", "TEXT");
  ensureColumn(db, "backup_records", "started_at", "TEXT");
  ensureColumn(db, "backup_records", "completed_at", "TEXT");
  ensureColumn(db, "backup_records", "exit_code", "INTEGER");
  ensureColumn(db, "backup_records", "replica_path", "TEXT");
  ensureColumn(db, "backup_records", "replica_sha256", "TEXT");
  ensureColumn(db, "backup_records", "replica_status", "TEXT");
  const version = db.prepare("SELECT version FROM schema_meta LIMIT 1").get();
  if (!version) db.prepare("INSERT INTO schema_meta (version) VALUES (2)").run();
  else if (version.version < 2) db.prepare("UPDATE schema_meta SET version = 2").run();
}

export function openDatabase(filePath = path.join(config.dataDir, "app.db")): DB {
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (filePath !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  seed(db);
  return db;
}

export function closeDatabase(db: DB) {
  if (db && db.open) db.close();
}

export function uuid() {
  return crypto.randomUUID();
}

export function cloneData(db: DB) {
  const tables = [
    "app_settings",
    "reference_sources",
    "food_groups",
    "foods",
    "food_versions",
    "recipe_groups",
    "recipes",
    "recipe_versions",
    "recipe_ingredients",
    "beverage_groups",
    "beverages",
    "portion_presets",
    "diet_entries",
    "beverage_entries",
    "urate_measurements",
  ];
  const result: Record<string, unknown[]> = {};
  for (const table of tables) result[table] = db.prepare(`SELECT * FROM ${table}`).all();
  return result;
}

export function validateExportPayload(payload: any) {
  if (!payload || payload.format !== "uric-acid-export" || payload.formatVersion !== "1") throw new Error("导出文件格式或版本不受支持");
  if (!payload.data || typeof payload.data !== "object") throw new Error("导出文件缺少数据区");
  const required = ["app_settings", "reference_sources", "food_groups", "foods", "food_versions", "recipe_groups", "recipes", "recipe_versions", "recipe_ingredients", "beverage_groups", "beverages", "portion_presets", "diet_entries", "beverage_entries", "urate_measurements"];
  for (const table of required) if (!Array.isArray(payload.data[table])) throw new Error(`导出文件缺少 ${table}`);
  const unknownTables = Object.keys(payload.data).filter((table) => !required.includes(table));
  if (unknownTables.length) throw new Error(`导出文件包含不支持的数据表：${unknownTables.join(", ")}`);
  return true;
}

export function replaceData(db: DB, data: Record<string, any[]>) {
  const tableOrder = [
    "diet_entries",
    "beverage_entries",
    "urate_measurements",
    "recipe_ingredients",
    "recipe_versions",
    "recipes",
    "food_versions",
    "foods",
    "beverages",
    "portion_presets",
    "reference_sources",
    "food_groups",
    "recipe_groups",
    "beverage_groups",
  ];
  const validatedTables = [...tableOrder, "app_settings"];
  const allowedColumns = new Map(validatedTables.map((table) => [table, new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column: any) => column.name))]));
  for (const table of validatedTables) {
    if (!Array.isArray(data[table])) throw new Error(`导出文件缺少 ${table}`);
    for (const row of data[table]) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${table} 包含无效记录`);
      const unsupported = Object.keys(row).filter((column) => !allowedColumns.get(table)?.has(column));
      if (unsupported.length) throw new Error(`${table} 包含不支持字段：${unsupported.join(", ")}`);
      if (!Object.keys(row).length) throw new Error(`${table} 包含空记录`);
    }
  }
  const statements = tableOrder.map((table) => ({ table, clear: db.prepare(`DELETE FROM ${table}`) }));
  const run = db.transaction(() => {
    for (const statement of statements) statement.clear.run();
    for (const table of [...tableOrder].reverse()) {
      const rows = data[table] || [];
      for (const row of rows) {
        const columns = Object.keys(row);
        const placeholders = columns.map(() => "?").join(",");
        const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES (${placeholders})`;
        db.prepare(sql).run(...columns.map((column) => row[column]));
      }
    }
  });
  run();
}

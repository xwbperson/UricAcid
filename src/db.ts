import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { config } from "./config";

export type DB = any;

function invalidExport(message: string) {
  const error: any = new Error(message);
  error.statusCode = 400;
  return error;
}

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

// 常见条目补充自 USDA/ODS Purine Database Release 2.0（2025）。
// 该数据库报告的是四种嘌呤碱基总量，和 WS/T 560 的检测口径并不完全相同，
// 因此这些条目保持 PREPARED，页面也会保留来源和口径说明。
const COMMON_FOOD_SEEDS = [
  ["food-cabbage", "圆白菜", "卷心菜,甘蓝", "food-vegetable", "生", 3.2],
  ["food-bok-choy", "小白菜", "青梗菜,白菜", "food-vegetable", "生", 12.4],
  ["food-broccoli", "西兰花", "绿花菜", "food-vegetable", "生", 70],
  ["food-cauliflower", "菜花", "花椰菜", "food-vegetable", "生", 57.2],
  ["food-cucumber", "黄瓜", "青瓜", "food-vegetable", "生", 9.4],
  ["food-tomato", "番茄", "西红柿", "food-vegetable", "生", 6.6],
  ["food-eggplant", "茄子", "茄瓜", "food-vegetable", "生", 50.8],
  ["food-green-beans", "四季豆", "豆角", "food-vegetable", "生", 7.5],
  ["food-lettuce", "生菜", "莴苣叶", "food-vegetable", "生", 4.7],
  ["food-onion", "洋葱", "", "food-vegetable", "生", 2.2],
  ["food-pumpkin", "南瓜", "", "food-vegetable", "生", 56.7],
  ["food-spinach", "菠菜", "", "food-vegetable", "生", 51.3],
  ["food-bean-sprout", "豆芽", "绿豆芽", "food-vegetable", "生", 35],
  ["food-corn", "玉米", "玉米粒", "food-grain", "生", 11.8],
  ["food-potato", "马铃薯", "土豆", "food-grain", "生", 6.5],
  ["food-white-bread", "白面包", "面包", "food-grain", "熟", 12.2],
  ["food-udon", "乌冬面", "小麦面条", "food-grain", "熟", 12.1],
  ["food-buckwheat-noodle", "荞麦面", "荞麦面条", "food-grain", "熟", 7.6],
  ["food-egg", "鸡蛋", "", "food-egg-milk", "熟", 0],
  ["food-milk", "牛奶", "", "food-egg-milk", "液态", 0],
  ["food-banana", "香蕉", "", "food-fruit", "可食部", 3],
  ["food-strawberry", "草莓", "", "food-fruit", "可食部", 2.2],
] as const;

const RECIPE_SEEDS = [
  ["recipe-tomato-egg", "番茄炒蛋", "西红柿炒鸡蛋", "recipe-home", 180, [["food-tomato", 100], ["food-egg", 100]]],
  ["recipe-broccoli-stir-fry", "清炒西兰花", "", "recipe-vegetable", 180, [["food-broccoli", 200]]],
  ["recipe-cucumber-salad", "凉拌黄瓜", "", "recipe-vegetable", 200, [["food-cucumber", 200]]],
  ["recipe-chicken-carrot", "胡萝卜炒鸡胸", "胡萝卜炒鸡肉", "recipe-meat", 200, [["food-carrot", 100], ["food-chicken-breast", 100]]],
  ["recipe-tomato-tofu-soup", "番茄豆腐汤", "", "recipe-soup", 400, [["food-tomato", 100], ["food-tofu", 200]]],
  ["recipe-millet-porridge", "小米粥", "", "recipe-staple", 400, [["food-millet", 50]]],
  ["recipe-corn-rice", "玉米米饭", "玉米饭", "recipe-staple", 300, [["food-rice", 150], ["food-corn", 50]]],
  ["recipe-potato-eggplant", "土豆烧茄子", "", "recipe-vegetable", 300, [["food-potato", 150], ["food-eggplant", 150]]],
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
  group_id_snapshot TEXT,
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
CREATE TABLE IF NOT EXISTS treatment_events (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  event_date TEXT NOT NULL,
  event_time TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('flare', 'hospital_check', 'oral_medication', 'topical_medication', 'symptom_change', 'follow_up', 'other')),
  title TEXT,
  notes TEXT,
  symptom_site TEXT,
  severity REAL CHECK (severity IS NULL OR (severity >= 0 AND severity <= 10)),
  symptom_state TEXT,
  symptom_description TEXT,
  medicine_name TEXT,
  dosage TEXT,
  dosage_unit TEXT,
  frequency TEXT,
  start_date TEXT,
  end_date TEXT,
  application_site TEXT,
  instructions TEXT,
  facility TEXT,
  department TEXT,
  clinician TEXT,
  test_name TEXT,
  report_conclusion TEXT,
  follow_up_date TEXT,
  plan_item TEXT,
  other_name TEXT,
  other_description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_treatment_events_date ON treatment_events(event_date, event_time, deleted_at);
CREATE INDEX IF NOT EXISTS idx_treatment_events_type ON treatment_events(event_type, event_date, deleted_at);
CREATE TABLE IF NOT EXISTS treatment_event_results (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES treatment_events(id) ON DELETE CASCADE,
  test_name TEXT,
  result_text TEXT,
  numeric_value REAL,
  unit TEXT,
  reference_range TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_treatment_results_event ON treatment_event_results(event_id, sort_order, created_at);
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
    "https://www.nhc.gov.cn/wjw/yingyang/201708/93b17b29518447ccb194188ab9a7335b/files/1739783557085_80487.pdf",
    "示例种子数据来源登记；每条记录仍需逐项复核后才能标记 VERIFIED。",
    timestamp,
  );
  db.prepare("UPDATE reference_sources SET url = ? WHERE id = ?").run(
    "https://www.nhc.gov.cn/wjw/yingyang/201708/93b17b29518447ccb194188ab9a7335b/files/1739783557085_80487.pdf",
    "source-wst-560-2017",
  );
  db.prepare("INSERT OR IGNORE INTO reference_sources (id, title, publisher, version, url, usage_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "source-nhc-2024-food-guide",
    "成人高尿酸血症与痛风食养指南（2024年版）",
    "国家卫生健康委",
    "2024",
    "https://www.nhc.gov.cn/sps/c100088/202402/9ba512ba8e314a47a181db11d2fa188d.shtml",
    "用于记录页的一般食养参考：食物多样、蔬菜和饮水等；不自动生成个人诊疗目标。",
    timestamp,
  );
  db.prepare("INSERT OR IGNORE INTO reference_sources (id, title, publisher, version, url, usage_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "source-usda-purine-2025",
    "USDA and ODS-NIH Database for the Purine Content of Foods",
    "USDA / NIH-ODS",
    "Release 2.0 (2025)",
    "https://www.ars.usda.gov/northeast-area/beltsville-md-bhnrc/beltsville-human-nutrition-research-center/methods-and-application-of-food-composition-laboratory/mafcl-site-pages/purine-content-of-foods/",
    "补充常见蔬菜、主食、水果和蛋奶；数值为四种嘌呤碱基总量（mg/100g），与 WS/T 560 的检测口径不同，暂保持 PREPARED。",
    timestamp,
  );
  db.prepare("INSERT OR IGNORE INTO reference_sources (id, title, publisher, version, url, usage_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "source-acr-2020-gout-guideline",
    "2020 American College of Rheumatology Guideline for the Management of Gout",
    "American College of Rheumatology",
    "2020",
    "https://rheumatology.org/press-releases/acr-releases-gout-management-guideline-with-emphasis-on-treat-to-target-strategy-for-urate-lowering-therapy",
    "仅用于已确诊痛风且正在接受降尿酸治疗时的目标说明；不用于单次高尿酸实测或无症状人群的自动诊断。",
    timestamp,
  );
  db.prepare("INSERT OR IGNORE INTO reference_sources (id, title, publisher, version, url, usage_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    "source-seed-recipe-examples",
    "系统预置常见菜谱示例",
    "Uric Acid Observation Desk",
    "v1",
    null,
    "按系统预置食物版本和示例配比计算；成品重量、油盐和烹饪失水不是通用标准，条目保持 PREPARED。",
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
  const commonVersionInsert = db.prepare("INSERT OR IGNORE INTO food_versions (id, food_id, version_no, basis_g, purine_low, purine_mean, purine_high, range_type, source_id, verification_status, notes, created_at) VALUES (?, ?, 1, 100, ?, ?, ?, 'single_point', 'source-usda-purine-2025', 'PREPARED', 'USDA/ODS Release 2.0 四种嘌呤碱基总量；与 WS/T 560 口径不同，尚未逐项人工复核。', ?)");
  for (const [id, name, aliases, groupId, state, value] of COMMON_FOOD_SEEDS) {
    foodInsert.run(id, name, aliases, groupId, state, timestamp, timestamp);
    commonVersionInsert.run(`${id}-v1`, id, value, value, value, timestamp);
  }
}

function insertSeedRecipes(db: DB) {
  const timestamp = now();
  const recipeInsert = db.prepare("INSERT OR IGNORE INTO recipes (id, name, aliases, group_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
  const versionInsert = db.prepare("INSERT OR IGNORE INTO recipe_versions (id, recipe_id, version_no, mode, final_yield_g, total_low, total_high, purine_low, purine_high, source_id, verification_status, notes, created_at) VALUES (?, ?, 1, 'ingredients', ?, ?, ?, ?, ?, 'source-seed-recipe-examples', 'PREPARED', ?, ?)");
  const ingredientInsert = db.prepare("INSERT OR IGNORE INTO recipe_ingredients (id, recipe_version_id, food_version_id, grams) VALUES (?, ?, ?, ?)");
  for (const [id, name, aliases, groupId, finalYieldG, ingredients] of RECIPE_SEEDS) {
    recipeInsert.run(id, name, aliases, groupId, timestamp, timestamp);
    const recipeVersionId = `${id}-v1`;
    const totals = ingredients.reduce((result, [foodId, grams]) => {
      const foodVersion = db.prepare("SELECT basis_g, purine_low, purine_high FROM food_versions WHERE id = ?").get(`${foodId}-v1`);
      if (!foodVersion || foodVersion.purine_low === null || foodVersion.purine_high === null) return result;
      result.low += (grams / foodVersion.basis_g) * foodVersion.purine_low;
      result.high += (grams / foodVersion.basis_g) * foodVersion.purine_high;
      result.known += 1;
      return result;
    }, { low: 0, high: 0, known: 0 });
    const totalLow = totals.known === ingredients.length ? Math.round((totals.low + Number.EPSILON) * 1000) / 1000 : null;
    const totalHigh = totals.known === ingredients.length ? Math.round((totals.high + Number.EPSILON) * 1000) / 1000 : null;
    const per100Low = totalLow === null ? null : Math.round((totalLow / finalYieldG) * 100 * 1000) / 1000;
    const per100High = totalHigh === null ? null : Math.round((totalHigh / finalYieldG) * 100 * 1000) / 1000;
    versionInsert.run(recipeVersionId, id, finalYieldG, totalLow, totalHigh, per100Low, per100High, "示例配比和成品重量；未计油盐，烹饪失水后应按实际情况另建版本。", timestamp);
    ingredients.forEach(([foodId, grams], index) => ingredientInsert.run(`${id}-ingredient-${index + 1}`, recipeVersionId, `${foodId}-v1`, grams));
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
  insertSeedRecipes(db);
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
  ensureColumn(db, "diet_entries", "group_id_snapshot", "TEXT");
  const version = db.prepare("SELECT version FROM schema_meta LIMIT 1").get();
  if (!version) db.prepare("INSERT INTO schema_meta (version) VALUES (4)").run();
  else if (version.version < 4) db.prepare("UPDATE schema_meta SET version = 4").run();
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
    "treatment_events",
    "treatment_event_results",
  ];
  const result: Record<string, unknown[]> = {};
  for (const table of tables) result[table] = db.prepare(`SELECT * FROM ${table}`).all();
  return result;
}

export function validateExportPayload(payload: any) {
  if (!payload || payload.format !== "uric-acid-export" || payload.formatVersion !== "1") throw invalidExport("导出文件格式或版本不受支持");
  if (!payload.data || typeof payload.data !== "object") throw invalidExport("导出文件缺少数据区");
  const required = ["app_settings", "reference_sources", "food_groups", "foods", "food_versions", "recipe_groups", "recipes", "recipe_versions", "recipe_ingredients", "beverage_groups", "beverages", "portion_presets", "diet_entries", "beverage_entries", "urate_measurements"];
  const optional = ["treatment_events", "treatment_event_results"];
  for (const table of required) if (!Array.isArray(payload.data[table])) throw invalidExport(`导出文件缺少 ${table}`);
  const unknownTables = Object.keys(payload.data).filter((table) => !required.includes(table) && !optional.includes(table));
  if (unknownTables.length) throw invalidExport(`导出文件包含不支持的数据表：${unknownTables.join(", ")}`);
  for (const table of optional) if (payload.data[table] !== undefined && !Array.isArray(payload.data[table])) throw invalidExport(`导出文件中的 ${table} 无效`);
  const expected = String(payload.manifest?.dataSha256 || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw invalidExport("导出文件缺少有效的 SHA-256 完整性清单");
  const actual = crypto.createHash("sha256").update(Buffer.from(JSON.stringify(payload.data))).digest("hex");
  if (actual !== expected) throw invalidExport("导出文件完整性校验失败；请重新导出或重新传输文件");
  for (const table of optional) if (payload.data[table] === undefined) payload.data[table] = [];
  return { verified: true, sha256: actual };
}

export function replaceData(db: DB, data: Record<string, any[]>) {
  const tableOrder = [
    "treatment_event_results",
    "treatment_events",
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

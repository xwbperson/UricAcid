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

  // WS/T 560—2017 附录 A 中未与上面条目重复的常见中式食物。
  ["food-duck-liver", "鸭肝", "", "food-organ", "未注明", 397.9],
  ["food-goose-liver", "鹅肝", "", "food-organ", "未注明", 376.9],
  ["food-pork-liver", "猪肝", "", "food-organ", "未注明", 275.21],
  ["food-beef-liver", "牛肝", "", "food-organ", "未注明", 250.6],
  ["food-lamb-liver", "羊肝", "", "food-organ", "未注明", 227.8],
  ["food-beef-jerky", "牛肉干", "", "food-meat", "干制", 127.4],
  ["food-yellow-croaker", "黄花鱼", "黄鱼", "food-seafood", "未注明", 124.26],
  ["food-processed-donkey-meat", "驴肉加工制品", "驴肉", "food-meat", "加工制品", 117.4],
  ["food-lamb", "羊肉", "", "food-meat", "未注明", 109.09],
  ["food-mixed-beef", "肥瘦牛肉", "牛肉", "food-meat", "未注明", 104.7],
  ["food-pork-floss", "猪肉松", "肉松", "food-meat", "加工制品", 76.25],
  ["food-soybean", "黄豆", "大豆", "food-bean", "未注明", 218.19],
  ["food-pumpkin-seed", "南瓜子", "南瓜籽", "food-nut", "未注明", 60.76],
  ["food-mung-bean", "绿豆", "", "food-bean", "未注明", 195.78],
  ["food-hazelnut-mushroom-dried", "榛蘑（干）", "榛蘑", "food-mushroom", "干制", 185.97],
  ["food-hericium-dried", "猴头菇（干）", "猴头菌", "food-mushroom", "干制", 177.66],
  ["food-soy-flour", "豆粉", "大豆粉", "food-bean", "干制", 167.49],
  ["food-pecan", "山核桃", "小核桃", "food-nut", "未注明", 40.44],
  ["food-sticky-rice", "糯米", "江米", "food-grain", "未注明", 50.38],
  ["food-fragrant-rice", "香米", "", "food-grain", "未注明", 34.37],
  ["food-yuba", "腐竹", "豆腐皮干", "food-bean", "干制", 159.87],
  ["food-bean-skin", "豆皮", "豆腐皮", "food-bean", "未注明", 157.28],
  ["food-red-kidney-bean", "红芸豆", "红腰豆", "food-bean", "未注明", 126.37],
  ["food-cassava", "木薯", "树薯", "food-grain", "未注明", 10.45],
  ["food-water-tofu", "水豆腐", "", "food-bean", "未注明", 67.57],
] as const;

// 常见条目补充自 USDA/ODS Purine Database Release 2.0（2025）。
// 该数据库报告的是四种嘌呤碱基总量，和 WS/T 560 的检测口径并不完全相同，
// 因此这些条目保持 PREPARED，页面也会保留来源和口径说明。
const COMMON_FOOD_SEEDS = [
  ["food-cabbage", "圆白菜", "卷心菜,甘蓝", "food-vegetable", "生", 3.2],
  ["food-bok-choy", "小白菜", "青梗菜,白菜", "food-vegetable", "未注明", 12.4],
  ["food-broccoli", "西兰花", "绿花菜", "food-vegetable", "生", 70],
  ["food-cauliflower", "菜花", "花椰菜", "food-vegetable", "生", 57.2],
  ["food-cucumber", "黄瓜", "青瓜", "food-vegetable", "生", 9.4],
  ["food-tomato", "番茄", "西红柿", "food-vegetable", "未注明", 6.6],
  ["food-eggplant", "茄子", "茄瓜", "food-vegetable", "生", 50.8],
  ["food-green-beans", "四季豆", "豆角", "food-vegetable", "未注明", 7.5],
  ["food-lettuce", "生菜", "莴苣叶", "food-vegetable", "未注明", 4.7],
  ["food-onion", "洋葱", "", "food-vegetable", "生", 2.2],
  ["food-pumpkin", "南瓜", "", "food-vegetable", "生", 56.7],
  ["food-spinach", "菠菜", "", "food-vegetable", "生", 51.3],
  ["food-bean-sprout", "豆芽", "绿豆芽", "food-vegetable", "生", 35],
  ["food-corn", "玉米", "玉米粒", "food-grain", "生", 11.8],
  ["food-potato", "马铃薯", "土豆", "food-grain", "生", 6.5],
  ["food-white-bread", "白面包", "面包", "food-grain", "未注明", 12.2],
  ["food-udon", "乌冬面", "小麦面条", "food-grain", "未注明", 12.1],
  ["food-buckwheat-noodle", "荞麦面", "荞麦面条", "food-grain", "未注明", 7.6],
  ["food-egg", "鸡蛋", "", "food-egg-milk", "生", 0],
  ["food-milk", "牛奶", "", "food-egg-milk", "液态", 0],
  ["food-banana", "香蕉", "", "food-fruit", "生", 3],
  ["food-strawberry", "草莓", "", "food-fruit", "生", 2.2],

  // 谷薯和主食：对应 USDA/ODS Release 2.0 的原始行名和状态；未写明状态的保留为“未注明”。
  ["food-rice-raw", "普通大米（生）", "生大米,白米", "food-grain", "生", 32.6],
  ["food-barley-raw", "大麦（生）", "大麦米", "food-grain", "生", 44.3],
  ["food-wheat-flour", "小麦面粉", "面粉,白面", "food-grain", "干制", 25.8],
  ["food-whole-wheat-flour", "全麦面粉", "全麦粉", "food-grain", "干制", 11.5],
  ["food-buckwheat-flour", "荞麦粉", "荞麦面粉", "food-grain", "干制", 75.9],
  ["food-baguette", "法棍面包", "法式面包", "food-grain", "未注明", 15.7],
  ["food-spaghetti", "意大利面", "意面,直条面", "food-grain", "未注明", 6.8],
  ["food-ramen", "拉面（面条）", "拉面", "food-grain", "未注明", 21.6],
  ["food-taro", "芋头", "芋艿", "food-grain", "未注明", 1.8],
  ["food-yam", "山药", "淮山", "food-grain", "未注明", 4],

  // 蔬菜：保留生、熟、未注明三类状态，不把不同样本状态合成一个数值。
  ["food-asparagus", "芦笋", "石刁柏", "food-vegetable", "生", 32.85],
  ["food-bitter-melon", "苦瓜", "凉瓜", "food-vegetable", "生", 9.9],
  ["food-bamboo-shoot", "竹笋", "笋", "food-vegetable", "生", 47.15],
  ["food-garlic-chives", "韭菜", "", "food-vegetable", "生", 19.4],
  ["food-garlic", "大蒜", "蒜头", "food-vegetable", "生", 17],
  ["food-ginger", "生姜", "姜", "food-vegetable", "生", 2.3],
  ["food-scallion", "大葱", "葱,青葱", "food-vegetable", "生", 41.4],
  ["food-okra", "秋葵", "羊角豆", "food-vegetable", "生", 39.51],
  ["food-lotus-root", "莲藕", "藕", "food-vegetable", "未注明", 0.3],
  ["food-turnip", "芜菁", "大头菜,蔓菁", "food-vegetable", "未注明", 3.9],
  ["food-zucchini", "西葫芦", "角瓜", "food-vegetable", "生", 13.1],
  ["food-green-pepper", "青椒", "青辣椒", "food-vegetable", "未注明", 2.3],
  ["food-sweet-green-pepper", "青甜椒", "青灯笼椒", "food-vegetable", "生", 69.1],
  ["food-red-pepper", "红椒", "红辣椒", "food-vegetable", "未注明", 5.1],
  ["food-red-paprika", "红彩椒", "红甜椒", "food-vegetable", "未注明", 1.1],
  ["food-coriander", "香菜", "芫荽", "food-vegetable", "未注明", 39.4],
  ["food-chrysanthemum-greens", "茼蒿", "菊花菜", "food-vegetable", "未注明", 47.1],
  ["food-cherry-tomato", "樱桃番茄", "小番茄", "food-vegetable", "生", 3.1],
  ["food-broccoli-cooked", "西兰花（熟）", "熟西兰花", "food-vegetable", "熟", 51.82],
  ["food-spinach-cooked", "菠菜（熟）", "熟菠菜", "food-vegetable", "熟", 39.18],
  ["food-yellow-bean-sprout", "黄豆芽", "大豆芽", "food-vegetable", "生", 57.4],

  // 菌菇和藻类：官方表将其列在蔬菜或海藻条目中，产品中归入独立的菌菇/藻类分组。
  ["food-shiitake-fresh", "香菇（鲜）", "鲜香菇", "food-mushroom", "生", 23.1],
  ["food-shiitake-dried", "香菇（干）", "干香菇", "food-mushroom", "干制", 311.55],
  ["food-enoki", "金针菇", "", "food-mushroom", "生", 49.3],
  ["food-king-oyster-mushroom", "杏鲍菇", "刺芹菇", "food-mushroom", "生", 13.44],
  ["food-oyster-mushroom", "平菇", "蚝菇", "food-mushroom", "生", 66.7],
  ["food-wood-ear-dried", "木耳（干）", "黑木耳", "food-mushroom", "干制", 155.7],
  ["food-kombu-dried", "海带（干）", "昆布", "food-mushroom", "干制", 46.4],
  ["food-wakame-raw", "裙带菜（生）", "海带芽", "food-mushroom", "生", 262.3],

  // 水果：Release 2.0 的食品表中可直接映射的常见水果条目较少，暂不从其他网页拼接数值。
  ["food-avocado", "牛油果", "鳄梨", "food-fruit", "生", 18.4],
  ["food-goji-berry", "枸杞", "枸杞子", "food-fruit", "未注明", 5.52],

  // 豆类及豆制品。
  ["food-edamame", "毛豆", "青大豆", "food-bean", "未注明", 48],
  ["food-green-pea", "青豌豆", "豌豆粒", "food-bean", "未注明", 21.9],
  ["food-podded-pea", "豌豆荚", "荷兰豆", "food-bean", "未注明", 10.4],
  ["food-broad-bean-dried", "蚕豆（干）", "胡豆", "food-bean", "干制", 35.5],
  ["food-adzuki-bean-dried", "红小豆（干）", "赤小豆", "food-bean", "干制", 77.6],
  ["food-soybean-dried", "黄豆（干）", "大豆", "food-bean", "干制", 172.5],
  ["food-chickpea-cooked", "鹰嘴豆（熟）", "鸡豆", "food-bean", "熟", 11.2],
  ["food-natto", "纳豆", "发酵大豆", "food-bean", "熟", 113.9],
  ["food-soft-tofu", "嫩豆腐", "内酯豆腐", "food-bean", "熟", 20],

  // 畜禽肉和加工肉制品。
  ["food-chicken-breast-raw", "鸡胸肉（生）", "生鸡胸", "food-meat", "生", 141.3],
  ["food-chicken-leg-raw", "鸡腿肉（生）", "生鸡腿", "food-meat", "生", 118.2],
  ["food-chicken-wing-raw", "鸡翅（生）", "生鸡翅", "food-meat", "生", 137.5],
  ["food-ham", "火腿", "火腿肉", "food-meat", "未注明", 69.4],
  ["food-bacon", "培根", "腊肉片", "food-meat", "未注明", 61.8],
  ["food-vienna-sausage", "维也纳香肠", "香肠", "food-meat", "未注明", 45.5],

  // 动物内脏。
  ["food-chicken-gizzard-raw", "鸡胗（生）", "鸡肫,生鸡胗", "food-organ", "生", 142.9],
  ["food-chicken-heart-raw", "鸡心（生）", "生鸡心", "food-organ", "生", 224],
  ["food-chicken-liver-raw", "鸡肝（生）", "生鸡肝", "food-organ", "生", 243],

  // 水产和海鲜：优先保留鱼种、部位和生熟状态明确的常见条目。
  ["food-shrimp-raw", "虾（生）", "生虾", "food-seafood", "生", 166.5],
  ["food-squid-raw", "鱿鱼（生）", "生鱿鱼", "food-seafood", "生", 150.8],
  ["food-salmon-raw", "三文鱼（生）", "鲑鱼", "food-seafood", "生", 124.7],
  ["food-mackerel-raw", "青花鱼（生）", "鲭鱼", "food-seafood", "生", 204.8],
  ["food-tuna-raw", "金枪鱼（生）", "吞拿鱼", "food-seafood", "生", 157.2],
  ["food-eel-raw", "鳗鱼（生）", "鳗鲡", "food-seafood", "生", 92.1],
  ["food-carp-raw", "鲤鱼（生）", "鲤鱼", "food-seafood", "生", 103.2],
  ["food-sea-bass-raw", "鲈鱼（生）", "鲈鱼", "food-seafood", "生", 107.3],
  ["food-hairtail-fresh", "带鱼（鲜）", "带鱼", "food-seafood", "鲜", 385.5],
  ["food-clam-raw", "蛤蜊（生）", "花蛤", "food-seafood", "生", 110.2],
  ["food-oyster-raw", "牡蛎（生）", "生蚝", "food-seafood", "生", 122],
  ["food-scallop-raw", "扇贝（生）", "生扇贝", "food-seafood", "生", 76.5],
  ["food-sea-cucumber-raw", "海参（生）", "生海参", "food-seafood", "生", 7.72],
  ["food-octopus-raw", "章鱼（生）", "八爪鱼", "food-seafood", "生", 137.2],

  // 蛋奶。
  ["food-quail-egg", "鹌鹑蛋", "", "food-egg-milk", "生", 0],
  ["food-yogurt", "原味酸奶", "酸奶", "food-egg-milk", "未注明", 5.2],
  ["food-low-fat-milk", "低脂牛奶", "2%牛奶", "food-egg-milk", "液态", 0.6],
  ["food-cheese", "奶酪", "芝士", "food-egg-milk", "未注明", 13],

  // 坚果和种子。
  ["food-peanut-raw", "花生（生）", "落花生", "food-nut", "生", 49.1],
  ["food-almond", "杏仁", "巴旦木", "food-nut", "未注明", 31.4],
  ["food-walnut", "核桃", "胡桃", "food-nut", "未注明", 19.6],
  ["food-sesame", "芝麻", "", "food-nut", "未注明", 36.3],

  // 汤料和调味品：仅收录官方表中有明确条目的成品/干制项。
  ["food-chinese-soup-powder", "中式汤粉（干）", "中式汤料", "food-soup", "干制", 185.9],
  ["food-chinese-stock-powder", "中式高汤粉（干）", "高汤粉", "food-soup", "干制", 508.9],
  ["food-potage-powder", "浓汤粉（干）", "浓汤料", "food-soup", "干制", 37.6],
  ["food-soy-sauce", "酱油", "生抽,老抽", "food-other", "液态", 50.25],
  ["food-oyster-sauce", "蚝油", "牡蛎酱", "food-other", "液态", 134.4],
  ["food-ketchup", "番茄酱", "", "food-other", "液态", 10.6],
  ["food-mayonnaise", "蛋黄酱", "沙拉酱", "food-other", "液态", 0.6],
  ["food-chili-bean-sauce", "豆瓣酱", "辣豆瓣酱", "food-other", "液态", 8.8],
  ["food-mustard", "芥末酱", "芥末", "food-other", "液态", 25.3],
  ["food-curry-roux", "咖喱块", "咖喱酱", "food-other", "固态", 16],
  ["food-fish-sauce", "鱼露", "鱼酱油", "food-other", "液态", 93.1],
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
CREATE TABLE IF NOT EXISTS medicines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('oral_medication', 'topical_medication')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_medicines_kind ON medicines(kind, archived_at, name);
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
  medicine_id TEXT REFERENCES medicines(id) ON DELETE SET NULL,
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
  db.prepare("UPDATE reference_sources SET url = ?, usage_note = ? WHERE id = ?").run(
    "https://www.nhc.gov.cn/wjw/yingyang/201708/93b17b29518447ccb194188ab9a7335b/files/1739783557085_80487.pdf",
    "食物种子数据来自附录 A；原表单位为 mg/kg，内置时换算为 mg/100g；每条记录仍需逐项复核后才能标记 VERIFIED。",
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
  db.prepare("UPDATE reference_sources SET usage_note = ? WHERE id = ?").run(
    "补充常见食物的跨分类参考；数值为 USDA/ODS Release 2.0 Table 1/2 的四种嘌呤碱基总量（mg/100g），与 WS/T 560 的检测口径不同；官方未注明保存状态的条目保留为“未注明”，暂保持 PREPARED。",
    "source-usda-purine-2025",
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
  const foodSync = db.prepare("UPDATE foods SET name = ?, aliases = ?, group_id = ?, state = ?, updated_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM food_versions WHERE food_id = ? AND version_no > 1)");
  const versionInsert = db.prepare("INSERT OR IGNORE INTO food_versions (id, food_id, version_no, basis_g, purine_low, purine_mean, purine_high, range_type, source_id, verification_status, notes, created_at) VALUES (?, ?, 1, 100, ?, ?, ?, 'single_point', 'source-wst-560-2017', 'PREPARED', '来源为 WS/T 560—2017 附录 A；原表单位 mg/kg，已换算为 mg/100g；尚未逐项人工复核。', ?)");
  for (const [id, name, aliases, groupId, state, value] of FOOD_SEEDS) {
    foodInsert.run(id, name, aliases, groupId, state, timestamp, timestamp);
    foodSync.run(name, aliases, groupId, state, timestamp, id, id);
    versionInsert.run(`${id}-v1`, id, value, value, value, timestamp);
  }
  const commonVersionInsert = db.prepare("INSERT OR IGNORE INTO food_versions (id, food_id, version_no, basis_g, purine_low, purine_mean, purine_high, range_type, source_id, verification_status, notes, created_at) VALUES (?, ?, 1, 100, ?, ?, ?, 'single_point', 'source-usda-purine-2025', 'PREPARED', 'USDA/ODS Release 2.0 Table 1/2 四种嘌呤碱基总量；与 WS/T 560 口径不同；官方行未注明保存状态的条目保留为“未注明”；尚未逐项人工复核。', ?)");
  for (const [id, name, aliases, groupId, state, value] of COMMON_FOOD_SEEDS) {
    foodInsert.run(id, name, aliases, groupId, state, timestamp, timestamp);
    foodSync.run(name, aliases, groupId, state, timestamp, id, id);
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
  ensureColumn(db, "treatment_events", "medicine_id", "TEXT REFERENCES medicines(id) ON DELETE SET NULL");
  const version = db.prepare("SELECT version FROM schema_meta LIMIT 1").get();
  if (!version) db.prepare("INSERT INTO schema_meta (version) VALUES (5)").run();
  else if (version.version < 5) db.prepare("UPDATE schema_meta SET version = 5").run();
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
    "medicines",
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
  const optional = ["medicines", "treatment_events", "treatment_event_results"];
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
    "medicines",
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

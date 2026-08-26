import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, openDatabase } from "../src/db";
import { Repository } from "../src/repository";

test("SQLite data, schema migrations and entry snapshots survive a reopen", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uric-acid-persistence-"));
  const filePath = path.join(directory, "app.db");
  const firstDb = openDatabase(filePath);
  const firstRepository = new Repository(firstDb);
  const food = firstRepository.createFood({ name: "持久化食物", basisG: 100, purineLow: 20, purineHigh: 30 });
  firstRepository.createDiet({ clientId: "persistent-client", date: "2026-08-01", kind: "food", versionId: food.versionId, quantityG: 100 });
  firstRepository.updateFood(food.id, { purineLow: 40, purineHigh: 50 });
  closeDatabase(firstDb);

  const secondDb = openDatabase(filePath);
  const secondRepository = new Repository(secondDb);
  const day = secondRepository.getDay("2026-08-01");
  assert.equal(day.summary.low, 20);
  assert.equal(day.summary.high, 30);
  assert.equal(day.dietEntries[0].referenceLow, 20);
  assert.equal(secondDb.prepare("SELECT version FROM schema_meta").get().version, 5);
  assert.equal(secondDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'").get().name, "audit_events");
  assert.ok(secondDb.prepare("PRAGMA table_info(backup_records)").all().some((row: any) => row.name === "replica_status"));
  closeDatabase(secondDb);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("seed library covers common foods, recipes and record-page guidance", () => {
  const db = openDatabase(":memory:");
  const repository = new Repository(db);
  const bootstrap = repository.bootstrap();
  assert.ok(bootstrap.foods.some((food: any) => food.name === "西兰花"));
  assert.ok(bootstrap.foods.some((food: any) => food.name === "香蕉"));
  assert.ok(bootstrap.foods.some((food: any) => food.name === "乌冬面"));
  assert.ok(bootstrap.recipes.some((recipe: any) => recipe.name === "番茄炒蛋"));
  assert.ok(bootstrap.sources.some((source: any) => source.id === "source-usda-purine-2025"));
  assert.ok(bootstrap.sources.some((source: any) => source.id === "source-nhc-2024-food-guide"));

  repository.createMeasurement({ clientId: "guidance-measurement", date: "2026-08-24", valueOriginal: 535, unitOriginal: "umol/L" });
  repository.createBeverageEntry({ clientId: "guidance-water", date: "2026-08-24", beverageId: "bev-water", amountMl: 1700, quantity: 1 });
  repository.createDiet({ clientId: "guidance-vegetable", date: "2026-08-24", kind: "food", versionId: "food-broccoli-v1", quantityG: 400 });
  db.prepare("UPDATE diet_entries SET group_id_snapshot = NULL WHERE client_id = ?").run("guidance-vegetable");
  const day = repository.getDay("2026-08-24");
  assert.equal(day.guidance.latestMeasurement.valueUmolL, 535);
  assert.equal(day.guidance.dietary.water.status, "near");
  assert.equal(day.guidance.dietary.vegetable.status, "near");
  assert.equal(day.guidance.dietary.vegetable.loggedG, 400);
  assert.deepEqual(day.guidance.alerts.map((alert: any) => alert.kind).sort(), ["urate", "vegetable", "water"]);

  const misleadingGroup = repository.createGroup("food", { name: "蔬菜" });
  const misleadingFood = repository.createFood({ name: "名称碰撞测试", groupId: misleadingGroup.id, basisG: 100, purineLow: 10, purineHigh: 10 });
  repository.createDiet({ clientId: "misleading-vegetable-name", date: "2026-08-25", kind: "food", versionId: misleadingFood.versionId, quantityG: 500 });
  assert.equal(repository.getDay("2026-08-25").guidance.dietary.vegetable.loggedG, 0);
  db.close();
});

test("seed food values and categories keep their documented source mappings", () => {
  const db = openDatabase(":memory:");
  const repository = new Repository(db);
  const bootstrap = repository.bootstrap();
  const foodsById = new Map(bootstrap.foods.map((food: any) => [food.id, food]));

  assert.equal(bootstrap.counts.foods, 157);
  const groupCounts = db.prepare("SELECT group_id AS groupId, COUNT(*) AS count FROM foods WHERE archived_at IS NULL GROUP BY group_id").all();
  assert.deepEqual(Object.fromEntries(groupCounts.map((row: any) => [row.groupId, row.count])), {
    "food-grain": 21,
    "food-vegetable": 36,
    "food-fruit": 7,
    "food-bean": 18,
    "food-mushroom": 11,
    "food-meat": 13,
    "food-organ": 9,
    "food-seafood": 19,
    "food-egg-milk": 6,
    "food-nut": 6,
    "food-soup": 3,
    "food-other": 8,
  });

  const expectedValues: Array<[string, number, string, string]> = [
    ["food-rice", 34.67, "source-wst-560-2017", "熟"],
    ["food-millet", 20.06, "source-wst-560-2017", "熟"],
    ["food-sweet-potato", 18.62, "source-wst-560-2017", "熟"],
    ["food-carrot", 13.23, "source-wst-560-2017", "生"],
    ["food-daikon", 10.98, "source-wst-560-2017", "生"],
    ["food-pineapple", 11.48, "source-wst-560-2017", "可食部"],
    ["food-pomelo", 8.37, "source-wst-560-2017", "可食部"],
    ["food-orange", 4.13, "source-wst-560-2017", "可食部"],
    ["food-soy-milk", 63.17, "source-wst-560-2017", "熟"],
    ["food-tofu", 68.63, "source-wst-560-2017", "熟"],
    ["food-chicken-breast", 207.97, "source-wst-560-2017", "熟"],
    ["food-pork", 137.84, "source-wst-560-2017", "生"],
    ["food-chicken-liver", 317, "source-wst-560-2017", "熟"],
    ["food-scallop", 193.44, "source-wst-560-2017", "可食部"],
    ["food-shrimp", 187.4, "source-wst-560-2017", "熟"],
    ["food-crab", 147, "source-wst-560-2017", "熟"],
    ["food-grass-carp", 134.44, "source-wst-560-2017", "熟"],
    ["food-dried-seaweed", 415.34, "source-wst-560-2017", "干制"],
    ["food-broccoli", 70, "source-usda-purine-2025", "生"],
    ["food-banana", 3, "source-usda-purine-2025", "生"],
    ["food-udon", 12.1, "source-usda-purine-2025", "未注明"],
    ["food-rice-raw", 32.6, "source-usda-purine-2025", "生"],
    ["food-asparagus", 32.85, "source-usda-purine-2025", "生"],
    ["food-avocado", 18.4, "source-usda-purine-2025", "生"],
    ["food-yellow-croaker", 124.26, "source-wst-560-2017", "未注明"],
    ["food-shiitake-dried", 311.55, "source-usda-purine-2025", "干制"],
    ["food-soy-sauce", 50.25, "source-usda-purine-2025", "液态"],
  ];
  for (const [id, value, sourceId, state] of expectedValues) {
    const food: any = foodsById.get(id);
    assert.ok(food, `missing seeded food ${id}`);
    assert.equal(food.purineMean, value, `${id} value`);
    assert.equal(food.purineLow, value, `${id} lower bound`);
    assert.equal(food.purineHigh, value, `${id} upper bound`);
    assert.equal(food.sourceId, sourceId, `${id} source`);
    assert.equal(food.state, state, `${id} state`);
    assert.equal(food.verificationStatus, "PREPARED", `${id} status`);
  }
  db.close();
});

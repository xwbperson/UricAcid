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
  assert.equal(secondDb.prepare("SELECT version FROM schema_meta").get().version, 4);
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

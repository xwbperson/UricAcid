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
  assert.equal(secondDb.prepare("SELECT version FROM schema_meta").get().version, 2);
  assert.equal(secondDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_events'").get().name, "audit_events");
  assert.ok(secondDb.prepare("PRAGMA table_info(backup_records)").all().some((row: any) => row.name === "replica_status"));
  closeDatabase(secondDb);
  fs.rmSync(directory, { recursive: true, force: true });
});

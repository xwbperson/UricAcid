import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { createApp } from "../src/server";
import { hashPassword } from "../src/auth";

const apps: any[] = [];
const testPassword = crypto.randomBytes(24).toString("base64url");
const passwordHashFile = path.join(os.tmpdir(), `uric-acid-test-${process.pid}.hash`);
afterEach(() => {
  for (const app of apps.splice(0)) app.locals.db.close();
  if (fs.existsSync(passwordHashFile)) fs.rmSync(passwordHashFile);
});

test("auth gate, CSRF and core entry flows work together", async () => {
  const app = createApp({ databasePath: ":memory:", passwordHash: hashPassword(testPassword), passwordHashFile });
  apps.push(app);
  const agent = request.agent(app);

  const health = await agent.get("/api/health");
  assert.equal(health.body.configured, true);
  assert.match(health.headers["content-security-policy"], /default-src 'self'/);
  assert.equal((await request(app).get("/api/auth/status").set("Cookie", "uricacid_device=stale-token")).headers["set-cookie"][0].includes("Max-Age=0"), true);
  assert.equal((await agent.get("/api/bootstrap")).status, 401);

  const login = await agent.post("/api/auth/login").send({ password: testPassword });
  assert.equal(login.status, 200);
  const csrf = login.body.csrfToken;
  assert.ok(csrf);
  assert.equal((await agent.post("/api/foods").send({ name: "测试食物", basisG: 100, purineLow: 20, purineHigh: 30 })).status, 403);

  const bootstrap = await agent.get("/api/bootstrap");
  assert.equal(bootstrap.status, 200);
  const foodGroup = (await agent.post("/api/groups/food").set("X-CSRF-Token", csrf).send({ name: "验收食物分组" })).body;
  const recipeGroup = (await agent.post("/api/groups/recipe").set("X-CSRF-Token", csrf).send({ name: "验收菜谱分组" })).body;
  const beverageGroup = (await agent.post("/api/groups/beverage").set("X-CSRF-Token", csrf).send({ name: "验收饮品分组" })).body;
  const createdFood = (await agent.post("/api/foods").set("X-CSRF-Token", csrf).send({ name: "验收食物", basisG: 100, purineLow: 20, purineHigh: 30, aliases: "测试", groupId: foodGroup.id })).body;
  assert.equal(createdFood.purineLow, 20);
  assert.equal(createdFood.purineHigh, 30);
  assert.equal(createdFood.groupName, "验收食物分组");

  const recipe = (await agent.post("/api/recipes").set("X-CSRF-Token", csrf).send({ name: "验收菜谱", mode: "ingredients", finalYieldG: 200, groupId: recipeGroup.id, ingredients: [{ foodVersionId: createdFood.versionId, grams: 100 }] })).body;
  assert.equal(recipe.purineLow, 10);
  assert.equal(recipe.purineHigh, 15);
  assert.equal(recipe.groupName, "验收菜谱分组");
  const draftRecipe = (await agent.post("/api/recipes").set("X-CSRF-Token", csrf).send({ name: "未完成菜谱", mode: "ingredients", groupId: recipeGroup.id, ingredients: [{ foodVersionId: createdFood.versionId, grams: 100 }] })).body;
  const draftUse = await agent.post("/api/diet-entries").set("X-CSRF-Token", csrf).send({ clientId: "draft-recipe-client", date: "2026-08-24", kind: "recipe", versionId: draftRecipe.versionId, quantityG: 100 });
  assert.equal(draftUse.status, 400);
  const libraryBeverage = (await agent.post("/api/beverages").set("X-CSRF-Token", csrf).send({ name: "验收饮品", groupId: beverageGroup.id, containsSugar: true })).body;
  assert.equal(libraryBeverage.groupName, "验收饮品分组");

  const dietPayload = { clientId: "same-client-id", date: "2026-08-24", kind: "food", versionId: createdFood.versionId, quantityG: 150 };
  const firstDiet = await agent.post("/api/diet-entries").set("X-CSRF-Token", csrf).send(dietPayload);
  const retryDiet = await agent.post("/api/diet-entries").set("X-CSRF-Token", csrf).send(dietPayload);
  assert.equal(firstDiet.status, 201);
  assert.equal(retryDiet.body.id, firstDiet.body.id);

  const beverage = await agent.post("/api/beverage-entries").set("X-CSRF-Token", csrf).send({ clientId: "bev-client", date: "2026-08-24", beverageId: "bev-water", amountMl: 500, quantity: 2 });
  assert.equal(beverage.status, 201);
  const contextDiet = await agent.post("/api/diet-entries").set("X-CSRF-Token", csrf).send({ clientId: "context-client", date: "2026-08-19", kind: "food", versionId: createdFood.versionId, quantityG: 100 });
  assert.equal(contextDiet.status, 201);
  const measurement = await agent.post("/api/measurements").set("X-CSRF-Token", csrf).send({ clientId: "measure-client", date: "2026-08-20", valueOriginal: 7, unitOriginal: "mg/dL" });
  assert.equal(measurement.status, 201);
  assert.equal(measurement.body.valueUmolL, 416.36);

  const day = await agent.get("/api/day?date=2026-08-24");
  assert.equal(day.body.summary.low, 30);
  assert.equal(day.body.summary.high, 45);
  assert.equal(day.body.beverage.totalMl, 1000);
  assert.equal(day.body.dietEntries.length, 1);

  const stats = await agent.get("/api/statistics?from=2026-08-01&to=2026-08-24");
  assert.equal(stats.body.urateStats.count, 1);
  assert.equal(stats.body.measurements[0].valueUmolL, 416.36);
  assert.equal(stats.body.comparisons[0].windows[0].recordedDays, 1);

  const deletedDiet = await agent.delete(`/api/diet-entries/${firstDiet.body.id}`).set("X-CSRF-Token", csrf);
  const deletedBeverageEntry = await agent.delete(`/api/beverage-entries/${beverage.body.id}`).set("X-CSRF-Token", csrf);
  const deletedMeasurement = await agent.delete(`/api/measurements/${measurement.body.id}`).set("X-CSRF-Token", csrf);
  assert.equal(deletedDiet.status, 200);
  assert.equal(deletedBeverageEntry.status, 200);
  assert.equal(deletedMeasurement.status, 200);
  const emptiedDay = await agent.get("/api/day?date=2026-08-24");
  assert.equal(emptiedDay.body.dietEntries.length, 0);
  assert.equal(emptiedDay.body.beverageEntries.length, 0);
  assert.equal(emptiedDay.body.measurements.length, 0);

  const deletedFoodGroup = await agent.delete(`/api/groups/food/${foodGroup.id}`).set("X-CSRF-Token", csrf);
  assert.equal(deletedFoodGroup.status, 200);
  const ungroupedAfterGroupDelete = await agent.get("/api/bootstrap");
  assert.equal(ungroupedAfterGroupDelete.body.foods.find((item: any) => item.id === createdFood.id).groupName, null);

  const deletedFood = await agent.delete(`/api/foods/${createdFood.id}`).set("X-CSRF-Token", csrf);
  const deletedRecipe = await agent.delete(`/api/recipes/${draftRecipe.id}`).set("X-CSRF-Token", csrf);
  const deletedLibraryBeverage = await agent.delete(`/api/beverages/${libraryBeverage.id}`).set("X-CSRF-Token", csrf);
  const protectedBeverageDelete = await agent.delete("/api/beverages/bev-water").set("X-CSRF-Token", csrf);
  assert.equal(deletedFood.status, 200);
  assert.equal(deletedRecipe.status, 200);
  assert.equal(deletedLibraryBeverage.status, 200);
  assert.equal(protectedBeverageDelete.status, 400);
  const afterArchive = await agent.get("/api/bootstrap");
  assert.equal(afterArchive.body.foods.some((item: any) => item.id === createdFood.id), false);
  assert.equal(afterArchive.body.recipes.some((item: any) => item.id === draftRecipe.id), false);
  assert.equal(afterArchive.body.beverages.some((item: any) => item.id === libraryBeverage.id), false);
  const preservedSnapshot = await agent.get("/api/day?date=2026-08-19");
  assert.equal(preservedSnapshot.body.dietEntries[0].name, "验收食物");
  assert.equal(app.locals.db.prepare("SELECT group_id FROM foods WHERE id = ?").get(createdFood.id).group_id, null);

  const settings = await agent.patch("/api/settings").set("X-CSRF-Token", csrf).send({ defaultUrateUnit: "mg/dL", waterGoalMl: 1800 });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.defaultUrateUnit, "mg/dL");
  const portions = await agent.put("/api/portions").set("X-CSRF-Token", csrf).send({ portions: [{ kind: "food", value: 125 }, { kind: "beverage", value: 750 }] });
  assert.equal(portions.status, 200);
  assert.equal(portions.body.portions.length, 2);

  const urateCsv = await agent.get("/api/exports/urate.csv");
  assert.equal(urateCsv.status, 200);
  assert.match(urateCsv.text, /value_original,unit_original,value_umol_l/);
  const dailyCsv = await agent.get("/api/exports/daily-summary.csv?from=2026-08-01&to=2026-08-24");
  assert.equal(dailyCsv.status, 200);
  assert.match(dailyCsv.text, /purine_low_mg,purine_high_mg,coverage/);
  const exportJson = await agent.get("/api/backup/export.json");
  assert.equal(exportJson.status, 200);
  const auditTypes = app.locals.db.prepare("SELECT event_type FROM audit_events").all().map((row: any) => row.event_type);
  assert.ok(auditTypes.includes("auth.login.success"));
  assert.ok(auditTypes.includes("backup.export.urate_csv"));
  assert.ok(auditTypes.includes("backup.export.daily_csv"));
  assert.ok(auditTypes.includes("backup.export.json"));

  const rejectedDelete = await agent.post("/api/data/delete-all").set("X-CSRF-Token", csrf).send({ confirmation: "wrong", createBackup: false });
  assert.equal(rejectedDelete.status, 400);
  const deleted = await agent.post("/api/data/delete-all").set("X-CSRF-Token", csrf).send({ confirmation: "DELETE_ALL_URIC_ACID", createBackup: false });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.counts.dietEntries, 2);
  assert.equal((await agent.get("/api/day?date=2026-08-24")).body.dietEntries.length, 0);
  assert.ok(app.locals.db.prepare("SELECT event_type FROM audit_events WHERE event_type = 'data.delete_all'").get());

  const unknownFood = (await agent.post("/api/foods").set("X-CSRF-Token", csrf).send({ name: "未知参考食物", basisG: 100 })).body;
  await agent.post("/api/diet-entries").set("X-CSRF-Token", csrf).send({ clientId: "unknown-client", date: "2026-08-23", kind: "food", versionId: unknownFood.versionId, quantityG: 100 });
  const unknownDay = await agent.get("/api/day?date=2026-08-23");
  assert.equal(unknownDay.body.summary.low, null);
  assert.equal(unknownDay.body.summary.high, null);
  assert.equal(unknownDay.body.summary.coverage, "partial");
});

test("password change revokes the current session", async () => {
  const app = createApp({ databasePath: ":memory:", passwordHash: hashPassword(testPassword), passwordHashFile });
  apps.push(app);
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ password: testPassword });
  const status = await agent.get("/api/auth/status");
  assert.equal(status.status, 200);
  const changed = await agent.post("/api/auth/password").set("X-CSRF-Token", status.body.csrfToken).send({ newPassword: crypto.randomBytes(24).toString("base64url") });
  assert.equal(changed.status, 200);
  assert.equal((await agent.get("/api/bootstrap")).status, 401);
});

test("portable export excludes sessions and restore invalidates all devices", async () => {
  const app = createApp({ databasePath: ":memory:", passwordHash: hashPassword(testPassword), passwordHashFile });
  apps.push(app);
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ password: testPassword });
  const treatment = await agent.post("/api/treatment-events").set("X-CSRF-Token", login.body.csrfToken).send({
    clientId: "backup-treatment-client",
    eventDate: "2026-08-24",
    eventType: "hospital_check",
    testName: "血尿酸",
    results: [{ testName: "血尿酸", resultText: "535", numericValue: 535, unit: "μmol/L" }],
  });
  assert.equal(treatment.status, 201);
  const exportResponse = await agent.get("/api/backup/export.json");
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.body.appVersion, "0.1.0");
  assert.equal(exportResponse.body.schemaVersion, 3);
  assert.equal(exportResponse.body.manifest.schemaVersion, 3);
  assert.equal(exportResponse.body.manifest.containsSecrets, false);
  assert.equal("trusted_device_sessions" in exportResponse.body.data, false);
  assert.equal(exportResponse.body.data.treatment_events.length, 1);
  assert.equal(exportResponse.body.data.treatment_event_results.length, 1);
  const preview = await agent.post("/api/backup/restore/preview").set("X-CSRF-Token", login.body.csrfToken).send(exportResponse.body);
  assert.equal(preview.status, 200);
  const invalidPayload = JSON.parse(JSON.stringify(exportResponse.body));
  invalidPayload.data.foods[0].group_id = "missing-group";
  invalidPayload.confirmation = "RESTORE_URIC_ACID";
  const failedRestore = await agent.post("/api/backup/restore").set("X-CSRF-Token", login.body.csrfToken).send(invalidPayload);
  assert.equal(failedRestore.status, 500);
  assert.equal((await agent.get("/api/bootstrap")).status, 200);
  const unsupportedPayload = JSON.parse(JSON.stringify(exportResponse.body));
  unsupportedPayload.data.foods[0].future_field = "must not be silently dropped";
  unsupportedPayload.confirmation = "RESTORE_URIC_ACID";
  const unsupportedRestore = await agent.post("/api/backup/restore").set("X-CSRF-Token", login.body.csrfToken).send(unsupportedPayload);
  assert.equal(unsupportedRestore.status, 400);
  assert.equal((await agent.get("/api/bootstrap")).status, 200);
  const restored = await agent.post("/api/backup/restore").set("X-CSRF-Token", login.body.csrfToken).send({ ...exportResponse.body, confirmation: "RESTORE_URIC_ACID" });
  assert.equal(restored.status, 200);
  assert.equal(app.locals.db.prepare("SELECT COUNT(*) AS count FROM treatment_events").get().count, 1);
  assert.equal(app.locals.db.prepare("SELECT COUNT(*) AS count FROM treatment_event_results").get().count, 1);
  assert.equal((await agent.get("/api/bootstrap")).status, 401);
});

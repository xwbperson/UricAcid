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

  assert.equal((await agent.get("/api/health")).body.configured, true);
  assert.equal((await agent.get("/api/bootstrap")).status, 401);

  const login = await agent.post("/api/auth/login").send({ password: testPassword });
  assert.equal(login.status, 200);
  const csrf = login.body.csrfToken;
  assert.ok(csrf);
  assert.equal((await agent.post("/api/foods").send({ name: "测试食物", basisG: 100, purineLow: 20, purineHigh: 30 })).status, 403);

  const bootstrap = await agent.get("/api/bootstrap");
  assert.equal(bootstrap.status, 200);
  const createdFood = (await agent.post("/api/foods").set("X-CSRF-Token", csrf).send({ name: "验收食物", basisG: 100, purineLow: 20, purineHigh: 30, aliases: "测试" })).body;
  assert.equal(createdFood.purineLow, 20);
  assert.equal(createdFood.purineHigh, 30);

  const recipe = (await agent.post("/api/recipes").set("X-CSRF-Token", csrf).send({ name: "验收菜谱", mode: "ingredients", finalYieldG: 200, ingredients: [{ foodVersionId: createdFood.versionId, grams: 100 }] })).body;
  assert.equal(recipe.purineLow, 10);
  assert.equal(recipe.purineHigh, 15);

  const dietPayload = { clientId: "same-client-id", date: "2026-08-24", kind: "food", versionId: createdFood.versionId, quantityG: 150 };
  const firstDiet = await agent.post("/api/diet-entries").set("X-CSRF-Token", csrf).send(dietPayload);
  const retryDiet = await agent.post("/api/diet-entries").set("X-CSRF-Token", csrf).send(dietPayload);
  assert.equal(firstDiet.status, 201);
  assert.equal(retryDiet.body.id, firstDiet.body.id);

  const beverage = await agent.post("/api/beverage-entries").set("X-CSRF-Token", csrf).send({ clientId: "bev-client", date: "2026-08-24", beverageId: "bev-water", amountMl: 500, quantity: 2 });
  assert.equal(beverage.status, 201);
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
  const exportResponse = await agent.get("/api/backup/export.json");
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.body.manifest.containsSecrets, false);
  assert.equal("trusted_device_sessions" in exportResponse.body.data, false);
  const preview = await agent.post("/api/backup/restore/preview").set("X-CSRF-Token", login.body.csrfToken).send(exportResponse.body);
  assert.equal(preview.status, 200);
  const restored = await agent.post("/api/backup/restore").set("X-CSRF-Token", login.body.csrfToken).send({ ...exportResponse.body, confirmation: "RESTORE_URIC_ACID" });
  assert.equal(restored.status, 200);
  assert.equal((await agent.get("/api/bootstrap")).status, 401);
});

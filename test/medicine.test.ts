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
const passwordHashFile = path.join(os.tmpdir(), `uric-acid-medicine-${process.pid}.hash`);

afterEach(() => {
  for (const app of apps.splice(0)) app.locals.db.close();
  if (fs.existsSync(passwordHashFile)) fs.rmSync(passwordHashFile);
});

test("managed medicines match treatment type and preserve archived history", async () => {
  const app = createApp({ databasePath: ":memory:", passwordHash: hashPassword(testPassword), passwordHashFile });
  apps.push(app);
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ password: testPassword });
  const csrf = login.body.csrfToken;

  const oral = await agent.post("/api/medicines").set("X-CSRF-Token", csrf).send({ name: "口服测试药", kind: "oral_medication", aliases: "测试简称", notes: "仅用于快捷选择" });
  const topical = await agent.post("/api/medicines").set("X-CSRF-Token", csrf).send({ name: "外用测试药", kind: "topical_medication" });
  assert.equal(oral.status, 201);
  assert.equal(oral.body.kindLabel, "口服药");
  assert.equal(topical.status, 201);

  const listed = await agent.get("/api/medicines");
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body.medicines.map((medicine: any) => medicine.name), ["口服测试药", "外用测试药"]);
  const bootstrap = await agent.get("/api/bootstrap");
  assert.equal(bootstrap.body.counts.medicines, 2);
  assert.equal(bootstrap.body.medicines.length, 2);

  const treatment = await agent.post("/api/treatment-events").set("X-CSRF-Token", csrf).send({
    clientId: "medicine-treatment",
    eventDate: "2026-08-24",
    eventType: "oral_medication",
    medicineId: oral.body.id,
    dosage: "1",
    dosageUnit: "片",
  });
  assert.equal(treatment.status, 201);
  assert.equal(treatment.body.medicineId, oral.body.id);
  assert.equal(treatment.body.medicineName, "口服测试药");

  const wrongKind = await agent.post("/api/treatment-events").set("X-CSRF-Token", csrf).send({
    clientId: "medicine-wrong-kind",
    eventDate: "2026-08-24",
    eventType: "oral_medication",
    medicineId: topical.body.id,
  });
  assert.equal(wrongKind.status, 400);

  const archived = await agent.delete(`/api/medicines/${oral.body.id}`).set("X-CSRF-Token", csrf);
  assert.equal(archived.status, 200);
  const activeAfterArchive = await agent.get("/api/medicines");
  assert.equal(activeAfterArchive.body.medicines.some((medicine: any) => medicine.id === oral.body.id), false);
  const allAfterArchive = await agent.get("/api/medicines?includeArchived=true");
  assert.equal(allAfterArchive.body.medicines.find((medicine: any) => medicine.id === oral.body.id).archivedAt !== null, true);

  const historical = await agent.get("/api/treatment-events?type=oral_medication");
  assert.equal(historical.body.events.length, 1);
  assert.equal(historical.body.events[0].medicineId, oral.body.id);
  assert.equal(historical.body.events[0].medicineName, "口服测试药");

  const exported = await agent.get("/api/backup/export.json");
  assert.ok(Array.isArray(exported.body.data.medicines));
  assert.equal(exported.body.data.medicines.length, 2);
});

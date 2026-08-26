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
const passwordHashFile = path.join(os.tmpdir(), `uric-acid-treatment-${process.pid}.hash`);

afterEach(() => {
  for (const app of apps.splice(0)) app.locals.db.close();
  if (fs.existsSync(passwordHashFile)) fs.rmSync(passwordHashFile);
});

test("treatment timeline keeps same-day events independent and filters by type", async () => {
  const app = createApp({ databasePath: ":memory:", passwordHash: hashPassword(testPassword), passwordHashFile });
  apps.push(app);
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ password: testPassword });
  const csrf = login.body.csrfToken;
  const shared = { eventDate: "2026-08-24" };

  const check = await agent.post("/api/treatment-events").set("X-CSRF-Token", csrf).send({
    clientId: "treatment-check",
    ...shared,
    eventTime: "09:10",
    eventType: "hospital_check",
    facility: "市立医院",
    department: "风湿免疫科",
    testName: "血尿酸",
    results: [
      { testName: "血尿酸", resultText: "535", numericValue: 535, unit: "μmol/L", referenceRange: "208–428" },
      { testName: "肌酐", resultText: "正常", note: "报告原文" },
    ],
  });
  const topical = await agent.post("/api/treatment-events").set("X-CSRF-Token", csrf).send({ clientId: "treatment-topical", ...shared, eventTime: "12:30", eventType: "topical_medication", medicineName: "外用药", applicationSite: "右脚踝" });
  const symptom = await agent.post("/api/treatment-events").set("X-CSRF-Token", csrf).send({ clientId: "treatment-symptom", ...shared, eventType: "symptom_change", symptomState: "缓解", severity: 4 });
  assert.equal(check.status, 201);
  assert.equal(check.body.results.length, 2);
  assert.equal(topical.status, 201);
  assert.equal(symptom.status, 201);

  const all = await agent.get("/api/treatment-events?from=2026-08-24&to=2026-08-24");
  assert.equal(all.status, 200);
  assert.equal(all.body.events.length, 3);
  assert.deepEqual(all.body.events.map((event: any) => event.eventType), ["topical_medication", "hospital_check", "symptom_change"]);

  const filtered = await agent.get("/api/treatment-events?type=topical_medication");
  assert.equal(filtered.body.events.length, 1);
  assert.equal(filtered.body.events[0].medicineName, "外用药");
  const day = await agent.get("/api/day?date=2026-08-24");
  assert.equal(day.body.treatmentEventCount, 3);

  const updated = await agent.put(`/api/treatment-events/${symptom.body.id}`).set("X-CSRF-Token", csrf).send({ eventDate: "2026-08-24", eventType: "symptom_change", symptomState: "加重", severity: 7, notes: "晚上疼痛增加", results: [] });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.severity, 7);
  const deleted = await agent.delete(`/api/treatment-events/${topical.body.id}`).set("X-CSRF-Token", csrf);
  assert.equal(deleted.status, 200);
  assert.equal((await agent.get("/api/treatment-events?from=2026-08-24&to=2026-08-24")).body.events.length, 2);
  const retagged = await agent.put("/api/treatment-events/" + check.body.id).set("X-CSRF-Token", csrf).send({ eventDate: "2026-08-24", eventType: "topical_medication", medicineName: "改为外用药" });
  assert.equal(retagged.status, 200);
  assert.equal(retagged.body.facility, null);
  assert.equal(retagged.body.testName, null);
  assert.equal(retagged.body.results.length, 0);
  assert.ok(app.locals.db.prepare("SELECT event_type FROM audit_events WHERE event_type = 'treatment.create'").get());
  assert.ok(app.locals.db.prepare("SELECT event_type FROM audit_events WHERE event_type = 'treatment.update'").get());
  assert.ok(app.locals.db.prepare("SELECT event_type FROM audit_events WHERE event_type = 'treatment.delete'").get());
});

test("treatment date rules and old export compatibility preserve data", async () => {
  const app = createApp({ databasePath: ":memory:", passwordHash: hashPassword(testPassword), passwordHashFile });
  apps.push(app);
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ password: testPassword });
  const csrf = login.body.csrfToken;
  const futureDate = "2099-01-01";
  const rejectedFuture = await agent.post("/api/treatment-events").set("X-CSRF-Token", csrf).send({ clientId: "future-flare", eventDate: futureDate, eventType: "flare" });
  assert.equal(rejectedFuture.status, 400);
  const allowedFuture = await agent.post("/api/treatment-events").set("X-CSRF-Token", csrf).send({ clientId: "future-flare-confirmed", eventDate: futureDate, eventType: "flare", allowFuture: true });
  assert.equal(allowedFuture.status, 201);
  const planned = await agent.post("/api/treatment-events").set("X-CSRF-Token", csrf).send({ clientId: "future-follow-up", eventDate: futureDate, eventType: "follow_up", planItem: "复诊" });
  assert.equal(planned.status, 201);

  const exported = (await agent.get("/api/backup/export.json")).body;
  assert.equal(exported.schemaVersion, 5);
  assert.ok(Array.isArray(exported.data.treatment_events));
  assert.ok(Array.isArray(exported.data.treatment_event_results));
  const oldPayload = JSON.parse(JSON.stringify(exported));
  delete oldPayload.data.medicines;
  delete oldPayload.data.treatment_events;
  delete oldPayload.data.treatment_event_results;
  oldPayload.manifest.dataSha256 = crypto.createHash("sha256").update(Buffer.from(JSON.stringify(oldPayload.data))).digest("hex");
  const preview = await agent.post("/api/backup/restore/preview").set("X-CSRF-Token", csrf).send(oldPayload);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.counts.treatment_events, 0);
});

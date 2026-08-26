import fs from "node:fs";
import path from "node:path";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { config, persistPasswordHash } from "./config";
import { closeDatabase, openDatabase, validateExportPayload, type DB } from "./db";
import {
  authMiddleware,
  clearDeviceCookie,
  configured,
  issueCsrfToken,
  issueSession,
  hashPassword,
  requireAuth,
  requireCsrf,
  revokeAllSessions,
  revokeSession,
  verifyPassword,
} from "./auth";
import { createDatabaseSnapshot, exportJsonBuffer, exportZipBuffer, sendDownload } from "./backup";
import { dailySummaryCsv, urateCsv } from "./csv";
import { recordAudit } from "./audit";
import { Repository } from "./repository";

type AppOptions = { databasePath?: string; publicDir?: string; passwordHash?: string; passwordHashFile?: string };

const loginAttempts = new Map<string, { count: number; firstAt: number; blockedUntil: number }>();
const MAX_LOGIN_ATTEMPT_KEYS = 4096;

function pruneLoginAttempts(now = Date.now()) {
  for (const [key, record] of loginAttempts) {
    if (now - record.firstAt > 15 * 60 * 1000 && record.blockedUntil <= now) loginAttempts.delete(key);
  }
  if (loginAttempts.size <= MAX_LOGIN_ATTEMPT_KEYS) return;
  const oldest = [...loginAttempts.entries()].sort((left, right) => left[1].firstAt - right[1].firstAt);
  for (const [key] of oldest.slice(0, loginAttempts.size - MAX_LOGIN_ATTEMPT_KEYS)) loginAttempts.delete(key);
}

function clientAddress(request: Request) {
  return String(request.ip || request.socket.remoteAddress || "unknown").slice(0, 80);
}

function loginAllowed(request: Request) {
  const key = clientAddress(request);
  const record = loginAttempts.get(key);
  const now = Date.now();
  pruneLoginAttempts(now);
  if (!record) return true;
  if (record.blockedUntil > now) return false;
  if (now - record.firstAt > 15 * 60 * 1000) {
    loginAttempts.delete(key);
    return true;
  }
  return true;
}

function loginFailed(request: Request) {
  const key = clientAddress(request);
  const now = Date.now();
  pruneLoginAttempts(now);
  const record = loginAttempts.get(key) || { count: 0, firstAt: now, blockedUntil: 0 };
  record.count += 1;
  if (record.count >= 5) record.blockedUntil = now + Math.min(15 * 60 * 1000, 1000 * 2 ** Math.min(record.count - 5, 9));
  loginAttempts.set(key, record);
}

function loginSucceeded(request: Request) {
  loginAttempts.delete(clientAddress(request));
}

function asyncRoute(handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown> | unknown) {
  return (request: Request, response: Response, next: NextFunction) => Promise.resolve(handler(request, response, next)).catch(next);
}

function handleError(error: any, _request: Request, response: Response, _next: NextFunction) {
  const message = error instanceof Error ? error.message : "请求处理失败";
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : /不存在|不能为空|必须|不支持|不能|格式|需要|范围|口令|重置|模板|删除/.test(message) ? 400 : 500;
  const database = (response.req.app as any).locals?.db;
  if (database) {
    try { recordAudit(database, "request.failure", _request, { path: _request.path, errorCode: error?.code || message.slice(0, 80) }); } catch { /* auditing must not hide the original failure */ }
  }
  if (status === 500 && error?.code !== "SQLITE_CONSTRAINT_FOREIGNKEY" && message !== "FOREIGN KEY constraint failed") console.error("request_failed", error?.stack || error);
  response.status(status).json({ error: status === 500 && config.nodeEnv === "production" ? "服务器处理失败" : message });
}

function ensureBodyObject(request: Request) {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) throw new Error("请求数据格式不正确");
  return request.body;
}

function findDateRange(data: Record<string, any[]>) {
  const dates: string[] = [];
  for (const table of ["diet_entries", "beverage_entries", "urate_measurements", "treatment_events"]) {
    for (const row of data[table] || []) {
      const value = row.entry_date || row.measured_date || row.event_date;
      if (value) dates.push(value);
    }
  }
  return dates.length ? { from: dates.sort()[0], to: dates.sort().at(-1) } : null;
}

export function createApp(options: AppOptions = {}) {
  if (options.passwordHash) config.passwordHash = options.passwordHash;
  if (options.passwordHashFile) config.passwordHashFile = path.resolve(options.passwordHashFile);
  const db = openDatabase(options.databasePath);
  const repository = new Repository(db);
  const app: Express = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_request, response, next) => {
    response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (config.nodeEnv === "production") response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });
  app.use(express.json({ limit: "5mb" }));
  app.use(authMiddleware(db));

  app.get("/api/health", (_request, response) => response.json({ ok: true, configured: configured(), service: "uric-acid", version: "0.1.0" }));

  app.get("/api/auth/status", (request, response) => {
    const session = (request as any).authSession;
    if (!session) return response.json({ configured: configured(), authenticated: false });
    return response.json({ configured: configured(), authenticated: true, expiresAt: session.expiresAt, deviceLabel: session.deviceLabel, csrfToken: issueCsrfToken(db, session) });
  });

  app.post("/api/auth/login", (request, response) => {
    if (!configured()) {
      recordAudit(db, "auth.login.rejected_unconfigured", request);
      return response.status(503).json({ error: "服务器尚未配置共享访问口令", code: "PASSWORD_NOT_CONFIGURED" });
    }
    if (!loginAllowed(request)) {
      recordAudit(db, "auth.login.rate_limited", request);
      return response.status(429).json({ error: "尝试次数过多，请稍后再试" });
    }
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!verifyPassword(password, config.passwordHash)) {
      loginFailed(request);
      recordAudit(db, "auth.login.failure", request);
      return response.status(401).json({ error: "共享访问口令不正确" });
    }
    loginSucceeded(request);
    const session = issueSession(db, request, response);
    recordAudit(db, "auth.login.success", request);
    return response.json({ authenticated: true, ...session });
  });

  app.post("/api/auth/logout", requireAuth, requireCsrf, (request, response) => {
    recordAudit(db, "auth.session.logout", request);
    revokeSession(db, (request as any).authSession.sessionId);
    clearDeviceCookie(response);
    response.json({ ok: true });
  });

  app.get("/api/auth/sessions", requireAuth, (_request, response) => {
    const sessions = db.prepare("SELECT id, created_at, expires_at, last_used_at, device_label, revoked_at FROM trusted_device_sessions ORDER BY last_used_at DESC").all();
    response.json({ sessions });
  });

  app.post("/api/auth/sessions/revoke/:id", requireAuth, requireCsrf, (request, response) => {
    recordAudit(db, "auth.session.revoke", request, { targetSessionId: String(request.params.id) });
    revokeSession(db, String(request.params.id));
    response.json({ ok: true });
  });

  app.post("/api/auth/sessions/revoke-all", requireAuth, requireCsrf, (request, response) => {
    recordAudit(db, "auth.session.revoke_all", request);
    revokeAllSessions(db);
    clearDeviceCookie(response);
    response.json({ ok: true });
  });

  app.post("/api/auth/password", requireAuth, requireCsrf, (request, response) => {
    const body = ensureBodyObject(request);
    const newHash = hashPassword(String(body.newPassword || ""));
    db.prepare("UPDATE app_settings SET updated_at = ? WHERE id = 1").run(new Date().toISOString());
    recordAudit(db, "auth.password.changed", request);
    persistPasswordHash(newHash);
    revokeAllSessions(db);
    clearDeviceCookie(response);
    response.json({ ok: true, message: "共享访问口令已修改，所有设备需要重新验证" });
  });

  app.get("/api/bootstrap", requireAuth, (request, response) => response.json(repository.bootstrap(String(request.query.search || ""))));
  app.get("/api/day", requireAuth, (request, response) => response.json(repository.getDay(request.query.date)));
  app.get("/api/history", requireAuth, (request, response) => response.json({ days: repository.history(request.query.from, request.query.to) }));
  app.get("/api/statistics", requireAuth, (request, response) => response.json(repository.statistics(request.query.from, request.query.to)));

  app.post("/api/diet-entries", requireAuth, requireCsrf, (request, response) => response.status(201).json(repository.createDiet(ensureBodyObject(request))));
  app.put("/api/diet-entries/:id", requireAuth, requireCsrf, (request, response) => response.json(repository.updateDiet(String(request.params.id), ensureBodyObject(request))));
  app.delete("/api/diet-entries/:id", requireAuth, requireCsrf, (request, response) => { repository.deleteDiet(String(request.params.id)); recordAudit(db, "diet.delete", request, { entryId: String(request.params.id) }); response.json({ ok: true }); });
  app.post("/api/beverage-entries", requireAuth, requireCsrf, (request, response) => response.status(201).json(repository.createBeverageEntry(ensureBodyObject(request))));
  app.put("/api/beverage-entries/:id", requireAuth, requireCsrf, (request, response) => response.json(repository.updateBeverageEntry(String(request.params.id), ensureBodyObject(request))));
  app.delete("/api/beverage-entries/:id", requireAuth, requireCsrf, (request, response) => { repository.deleteBeverageEntry(String(request.params.id)); recordAudit(db, "beverage.delete", request, { entryId: String(request.params.id) }); response.json({ ok: true }); });
  app.post("/api/measurements", requireAuth, requireCsrf, (request, response) => response.status(201).json(repository.createMeasurement(ensureBodyObject(request))));
  app.put("/api/measurements/:id", requireAuth, requireCsrf, (request, response) => response.json(repository.updateMeasurement(String(request.params.id), ensureBodyObject(request))));
  app.delete("/api/measurements/:id", requireAuth, requireCsrf, (request, response) => { repository.deleteMeasurement(String(request.params.id)); recordAudit(db, "urate.delete", request, { measurementId: String(request.params.id) }); response.json({ ok: true }); });
  app.get("/api/treatment-events", requireAuth, (request, response) => response.json({ events: repository.listTreatmentEvents(request.query.from, request.query.to, request.query.type, request.query.q) }));
  app.post("/api/treatment-events", requireAuth, requireCsrf, (request, response) => {
    const event = repository.createTreatmentEvent(ensureBodyObject(request));
    recordAudit(db, "treatment.create", request, { eventId: event.id, eventType: event.eventType });
    return response.status(201).json(event);
  });
  app.put("/api/treatment-events/:id", requireAuth, requireCsrf, (request, response) => {
    const event = repository.updateTreatmentEvent(String(request.params.id), ensureBodyObject(request));
    recordAudit(db, "treatment.update", request, { eventId: event.id, eventType: event.eventType });
    return response.json(event);
  });
  app.delete("/api/treatment-events/:id", requireAuth, requireCsrf, (request, response) => {
    const id = String(request.params.id);
    repository.deleteTreatmentEvent(id);
    recordAudit(db, "treatment.delete", request, { eventId: id });
    return response.json({ ok: true });
  });

  app.post("/api/foods", requireAuth, requireCsrf, (request, response) => response.status(201).json(repository.createFood(ensureBodyObject(request))));
  app.put("/api/foods/:id", requireAuth, requireCsrf, (request, response) => response.json(repository.updateFood(String(request.params.id), ensureBodyObject(request))));
  app.delete("/api/foods/:id", requireAuth, requireCsrf, (request, response) => { const id = String(request.params.id); repository.archiveFood(id); recordAudit(db, "food.archive", request, { foodId: id }); response.json({ ok: true, archived: true }); });
  app.post("/api/recipes", requireAuth, requireCsrf, (request, response) => response.status(201).json(repository.createRecipe(ensureBodyObject(request))));
  app.put("/api/recipes/:id", requireAuth, requireCsrf, (request, response) => response.json(repository.updateRecipe(String(request.params.id), ensureBodyObject(request))));
  app.delete("/api/recipes/:id", requireAuth, requireCsrf, (request, response) => { const id = String(request.params.id); repository.archiveRecipe(id); recordAudit(db, "recipe.archive", request, { recipeId: id }); response.json({ ok: true, archived: true }); });
  app.post("/api/beverages", requireAuth, requireCsrf, (request, response) => response.status(201).json(repository.createBeverage(ensureBodyObject(request))));
  app.put("/api/beverages/:id", requireAuth, requireCsrf, (request, response) => response.json(repository.updateBeverage(String(request.params.id), ensureBodyObject(request))));
  app.delete("/api/beverages/:id", requireAuth, requireCsrf, (request, response) => { const id = String(request.params.id); repository.archiveBeverage(id); recordAudit(db, "beverage.archive", request, { beverageId: id }); response.json({ ok: true, archived: true }); });
  app.post("/api/groups/:kind", requireAuth, requireCsrf, (request, response) => response.status(201).json(repository.createGroup(String(request.params.kind), ensureBodyObject(request))));
  app.put("/api/groups/:kind/:id", requireAuth, requireCsrf, (request, response) => response.json(repository.renameGroup(String(request.params.kind), String(request.params.id), ensureBodyObject(request))));
  app.delete("/api/groups/:kind/:id", requireAuth, requireCsrf, (request, response) => { repository.deleteGroup(String(request.params.kind), String(request.params.id)); response.json({ ok: true }); });
  app.put("/api/portions", requireAuth, requireCsrf, (request, response) => response.json({ portions: repository.updatePortions(ensureBodyObject(request)) }));
  app.patch("/api/settings", requireAuth, requireCsrf, (request, response) => response.json(repository.updateSettings(ensureBodyObject(request))));
  app.post("/api/data/delete-all", requireAuth, requireCsrf, asyncRoute(async (request, response) => {
    const body = ensureBodyObject(request);
    if (String(body.confirmation || "") !== "DELETE_ALL_URIC_ACID") throw new Error("删除前请输入确认短语 DELETE_ALL_URIC_ACID");
    if (body.createBackup !== false && String(db.name) !== ":memory:") await createDatabaseSnapshot(db, repository);
    const result = repository.deletePersonalData();
    recordAudit(db, "data.delete_all", request, { deletedAt: result.deletedAt });
    response.json({ ok: true, ...result });
  }));
  app.post("/api/sources", requireAuth, requireCsrf, (request, response) => {
    const body = ensureBodyObject(request); const id = cryptoRandomUuid(); const at = new Date().toISOString();
    db.prepare("INSERT INTO reference_sources (id, title, publisher, version, url, file_hash, usage_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, body.title, body.publisher || null, body.version || null, body.url || null, body.fileHash || null, body.usageNote || null, at);
    response.status(201).json(db.prepare("SELECT * FROM reference_sources WHERE id = ?").get(id));
  });

  app.get("/api/backup/records", requireAuth, (_request, response) => response.json({ records: db.prepare("SELECT * FROM backup_records ORDER BY created_at DESC").all() }));
  app.get("/api/backup/export.json", requireAuth, (request, response) => { recordAudit(db, "backup.export.json", request); return sendDownload(response, exportJsonBuffer(repository), `uric-acid-export-${Date.now()}.json`, "application/json; charset=utf-8"); });
  app.get("/api/backup/export.zip", requireAuth, asyncRoute(async (request, response) => { recordAudit(db, "backup.export.zip", request); return sendDownload(response, await exportZipBuffer(repository), `uric-acid-export-${Date.now()}.zip`, "application/zip"); }));
  app.get("/api/exports/urate.csv", requireAuth, (request, response) => { recordAudit(db, "backup.export.urate_csv", request); return sendDownload(response, Buffer.from(urateCsv(db), "utf8"), `uric-acid-urate-${Date.now()}.csv`, "text/csv; charset=utf-8"); });
  app.get("/api/exports/daily-summary.csv", requireAuth, (request, response) => { recordAudit(db, "backup.export.daily_csv", request); return sendDownload(response, Buffer.from(dailySummaryCsv(repository, request.query.from, request.query.to), "utf8"), `uric-acid-daily-summary-${Date.now()}.csv`, "text/csv; charset=utf-8"); });
  app.post("/api/backup/snapshot", requireAuth, requireCsrf, asyncRoute(async (request, response) => { const result = await createDatabaseSnapshot(db, repository); recordAudit(db, "backup.snapshot.created", request, { status: result.status, replicaStatus: result.replica.status }); return response.status(result.status === "PREPARED" ? 201 : 502).json(result); }));
  app.post("/api/backup/restore/preview", requireAuth, requireCsrf, (request, response) => {
    const body = ensureBodyObject(request); const integrity = validateExportPayload(body);
    const data = body.data;
    recordAudit(db, "backup.restore.preview", request, { dateRange: findDateRange(data), counts: Object.fromEntries(Object.entries(data).map(([key, value]: any) => [key, value.length])) });
    response.json({ format: body.format, formatVersion: body.formatVersion, exportedAt: body.exportedAt, integrity, counts: Object.fromEntries(Object.entries(data).map(([key, value]: any) => [key, value.length])), dateRange: findDateRange(data) });
  });
  app.post("/api/backup/restore", requireAuth, requireCsrf, asyncRoute(async (request, response) => {
    const body = ensureBodyObject(request); validateExportPayload(body);
    if (String(body.confirmation || "") !== "RESTORE_URIC_ACID") throw new Error("恢复前请输入确认短语 RESTORE_URIC_ACID");
    if (String(db.name) !== ":memory:") await createDatabaseSnapshot(db, repository);
    repository.restoreData(body);
    recordAudit(db, "backup.restore.completed", request, { dateRange: findDateRange(body.data) });
    response.json({ ok: true, message: "恢复完成；所有设备凭证已清除，需要重新验证共享访问口令" });
  }));

  const publicDir = options.publicDir || path.join(process.cwd(), "public");
  if (fs.existsSync(publicDir)) app.use(express.static(publicDir, { index: "index.html", dotfiles: "deny" }));
  app.get(/.*/, (request, response) => {
    if (request.path.startsWith("/api/")) return response.status(404).json({ error: "接口不存在" });
    return response.sendFile(path.join(publicDir, "index.html"));
  });
  app.use(handleError);
  app.locals.db = db;
  app.locals.repository = repository;
  return app;
}

function cryptoRandomUuid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

if (require.main === module) {
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`UricAcid listening on http://localhost:${config.port}`);
    if (!configured()) console.warn("SHARED_PASSWORD_HASH 未配置：业务 API 将保持锁定，请运行 npm run setup:password");
  });
  const shutdown = () => {
    server.close(() => closeDatabase(app.locals.db));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

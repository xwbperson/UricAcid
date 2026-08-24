import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config, isProduction } from "./config";
import type { DB } from "./db";
import { uuid } from "./db";

export const DEVICE_COOKIE = "uricacid_device";
const SESSION_COOKIE_DAYS = Math.max(1, config.sessionDays);

export type AuthContext = {
  sessionId: string;
  token: string;
  csrfToken: string;
  deviceLabel: string | null;
  expiresAt: string;
};

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function encode(value: Buffer) {
  return value.toString("base64url");
}

export function hashPassword(password: string) {
  if (!password || password.length < 8) throw new Error("共享访问口令至少需要 8 个字符");
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return `scrypt$32768$8$1$${encode(salt)}$${encode(key)}`;
}

export function verifyPassword(password: string, encoded: string) {
  try {
    const [algorithm, n, r, p, saltEncoded, keyEncoded] = encoded.split("$");
    if (algorithm !== "scrypt" || !n || !r || !p || !saltEncoded || !keyEncoded) return false;
    const salt = Buffer.from(saltEncoded, "base64url");
    const expected = Buffer.from(keyEncoded, "base64url");
    const actual = crypto.scryptSync(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024 });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function configured() {
  return Boolean(config.passwordHash);
}

function parseCookies(request: Request) {
  const raw = request.headers.cookie || "";
  return Object.fromEntries(raw.split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function setCookie(response: Response, value: string, maxAgeSeconds: number) {
  const attributes = [
    `${DEVICE_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isProduction()) attributes.push("Secure");
  response.setHeader("Set-Cookie", attributes.join("; "));
}

export function clearDeviceCookie(response: Response) {
  response.setHeader("Set-Cookie", `${DEVICE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isProduction() ? "; Secure" : ""}`);
}

function deviceLabel(request: Request) {
  const userAgent = String(request.headers["user-agent"] || "未知设备").replace(/[\r\n]/g, " ");
  return userAgent.slice(0, 160);
}

export function getSession(db: DB, token: string | undefined): AuthContext | null {
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = db.prepare(`
    SELECT s.*, a.session_generation
    FROM trusted_device_sessions s CROSS JOIN app_settings a
    WHERE s.token_hash = ? AND s.revoked_at IS NULL
      AND s.expires_at > ? AND s.generation = a.session_generation
    LIMIT 1
  `).get(tokenHash, new Date().toISOString());
  if (!row) return null;
  const csrfToken = row.__csrfToken || "";
  return { sessionId: row.id, token, csrfToken, deviceLabel: row.device_label, expiresAt: row.expires_at };
}

export function getSessionFromRequest(db: DB, request: Request) {
  const cookies = parseCookies(request);
  const token = cookies[DEVICE_COOKIE];
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = db.prepare(`
    SELECT s.*, a.session_generation
    FROM trusted_device_sessions s CROSS JOIN app_settings a
    WHERE s.token_hash = ? AND s.revoked_at IS NULL
      AND s.expires_at > ? AND s.generation = a.session_generation
    LIMIT 1
  `).get(tokenHash, new Date().toISOString());
  if (!row) return null;
  db.prepare("UPDATE trusted_device_sessions SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return {
    sessionId: row.id,
    token,
    csrfHash: row.csrf_hash,
    deviceLabel: row.device_label,
    expiresAt: row.expires_at,
    generation: row.generation,
  };
}

export function issueSession(db: DB, request: Request, response: Response) {
  const settings = db.prepare("SELECT session_generation FROM app_settings WHERE id = 1").get();
  const token = encode(crypto.randomBytes(32));
  const csrfToken = encode(crypto.randomBytes(32));
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_COOKIE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO trusted_device_sessions (id, token_hash, csrf_hash, generation, created_at, expires_at, last_used_at, device_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid(), sha256(token), sha256(csrfToken), settings.session_generation, createdAt.toISOString(), expiresAt, createdAt.toISOString(), deviceLabel(request));
  setCookie(response, token, SESSION_COOKIE_DAYS * 24 * 60 * 60);
  return { csrfToken, expiresAt };
}

export function csrfValid(request: Request, session: ReturnType<typeof getSessionFromRequest>) {
  const supplied = request.headers["x-csrf-token"];
  if (!session || typeof supplied !== "string") return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(supplied)), Buffer.from(session.csrfHash));
}

export function revokeSession(db: DB, sessionId: string) {
  db.prepare("UPDATE trusted_device_sessions SET revoked_at = ? WHERE id = ?").run(new Date().toISOString(), sessionId);
}

export function revokeAllSessions(db: DB) {
  const timestamp = new Date().toISOString();
  const run = db.transaction(() => {
    db.prepare("UPDATE trusted_device_sessions SET revoked_at = COALESCE(revoked_at, ?)").run(timestamp);
    db.prepare("UPDATE app_settings SET session_generation = session_generation + 1, updated_at = ? WHERE id = 1").run(timestamp);
  });
  run();
}

export function issueCsrfToken(db: DB, sessionId: string) {
  const token = encode(crypto.randomBytes(32));
  db.prepare("UPDATE trusted_device_sessions SET csrf_hash = ? WHERE id = ? AND revoked_at IS NULL").run(sha256(token), sessionId);
  return token;
}

export function authMiddleware(db: DB) {
  return (request: Request, _response: Response, next: NextFunction) => {
    (request as any).authSession = getSessionFromRequest(db, request);
    next();
  };
}

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  if (!(request as any).authSession) return response.status(401).json({ error: "需要先验证共享访问口令", code: "AUTH_REQUIRED" });
  next();
}

export function requireCsrf(request: Request, response: Response, next: NextFunction) {
  if (!csrfValid(request, (request as any).authSession)) return response.status(403).json({ error: "请求校验已过期，请刷新页面后重试", code: "CSRF_INVALID" });
  next();
}

export function sessionPublic(db: DB, request: Request) {
  const session = (request as any).authSession;
  if (!session) return null;
  return { authenticated: true, expiresAt: session.expiresAt, deviceLabel: session.deviceLabel, csrfToken: issueCsrfToken(db, session.sessionId) };
}

export { parseCookies };

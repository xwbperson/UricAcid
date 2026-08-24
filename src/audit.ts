import type { Request } from "express";
import type { DB } from "./db";
import { uuid } from "./db";

export function recordAudit(db: DB, eventType: string, request?: Request, metadata: Record<string, unknown> = {}) {
  const sessionId = (request as any)?.authSession?.sessionId || null;
  db.prepare("INSERT INTO audit_events (id, event_type, created_at, session_id, metadata_json) VALUES (?, ?, ?, ?, ?)").run(
    uuid(),
    eventType,
    new Date().toISOString(),
    sessionId,
    JSON.stringify(metadata),
  );
}

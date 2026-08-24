import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import Database from "better-sqlite3";
import type { Response } from "express";
import { config } from "./config";
import type { DB } from "./db";
import { Repository } from "./repository";

export function sha256Buffer(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function backupKey() {
  return config.backupEncryptionKey ? crypto.createHash("sha256").update(config.backupEncryptionKey).digest() : null;
}

function encryptedSnapshotHeader() {
  const version = String(config.backupKeyVersion || "v1").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 32) || "v1";
  return Buffer.from(`UADB1:${version}\n`);
}

function encryptedSnapshotOffset(payload: Buffer) {
  if (payload.subarray(0, 6).toString() === "UADB1\n") return 6;
  if (payload.subarray(0, 6).toString() !== "UADB1:") return -1;
  const newline = payload.indexOf(10);
  return newline >= 0 ? newline + 1 : -1;
}

function encryptSnapshot(inputPath: string, outputPath: string) {
  const key = backupKey();
  if (!key) return false;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(fs.readFileSync(inputPath)), cipher.final()]);
  const authTag = cipher.getAuthTag();
  fs.writeFileSync(outputPath, Buffer.concat([encryptedSnapshotHeader(), iv, authTag, encrypted]), { mode: 0o600 });
  return true;
}

function decryptSnapshot(inputPath: string, outputPath: string) {
  const key = backupKey();
  if (!key) throw new Error("解密 SQLite 快照需要 BACKUP_ENCRYPTION_KEY");
  const payload = fs.readFileSync(inputPath);
  const offset = encryptedSnapshotOffset(payload);
  if (offset < 0 || payload.length < offset + 28) throw new Error("SQLite 快照加密格式不受支持");
  const iv = payload.subarray(offset, offset + 12);
  const authTag = payload.subarray(offset + 12, offset + 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  fs.writeFileSync(outputPath, Buffer.concat([decipher.update(payload.subarray(offset + 28)), decipher.final()]), { mode: 0o600 });
}

function isInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function replicateSnapshot(sourcePath: string) {
  if (!config.backupReplicaDir) return { status: "NOT_CONFIGURED", path: null, sha256: null };
  const targetPath = path.join(config.backupReplicaDir, path.basename(sourcePath));
  try {
    fs.mkdirSync(config.backupReplicaDir, { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    const sourceHash = sha256Buffer(fs.readFileSync(sourcePath));
    const replicaHash = sha256Buffer(fs.readFileSync(targetPath));
    return { status: sourceHash === replicaHash ? "VERIFIED" : "FAILED", path: targetPath, sha256: replicaHash };
  } catch {
    return { status: "FAILED", path: targetPath, sha256: null };
  }
}

function pruneBackups(db: DB, backupDir: string) {
  const rows = db.prepare("SELECT id, file_path, replica_path, status FROM backup_records WHERE backup_type = 'sqlite_snapshot' ORDER BY created_at DESC").all();
  for (const row of rows.slice(config.backupRetention)) {
    for (const filePath of [row.file_path, row.replica_path]) {
      if (filePath && (isInside(backupDir, filePath) || (config.backupReplicaDir && isInside(config.backupReplicaDir, filePath))) && fs.existsSync(filePath)) fs.rmSync(filePath);
    }
    db.prepare("UPDATE backup_records SET status = 'PRUNED', completed_at = COALESCE(completed_at, ?), note = COALESCE(note, '') || ' 已按保留策略清理文件。' WHERE id = ?").run(new Date().toISOString(), row.id);
  }
}

export function exportJsonBuffer(repository: Repository) {
  const payload = repository.exportData();
  const dataBuffer = Buffer.from(JSON.stringify(payload.data));
  const enriched = {
    ...payload,
    manifest: {
      format: payload.format,
      formatVersion: payload.formatVersion,
      appVersion: payload.appVersion,
      schemaVersion: payload.schemaVersion,
      exportedAt: payload.exportedAt,
      timezone: payload.timezone,
      dataSha256: sha256Buffer(dataBuffer),
      containsSecrets: false,
      includesTrustedDeviceSessions: false,
    },
  };
  return Buffer.from(JSON.stringify(enriched, null, 2));
}

export async function exportZipBuffer(repository: Repository) {
  const json = exportJsonBuffer(repository);
  const payload = JSON.parse(json.toString("utf8"));
  const manifest = JSON.stringify({ format: payload.format, formatVersion: payload.formatVersion, appVersion: payload.appVersion, schemaVersion: payload.schemaVersion, exportedAt: payload.exportedAt, timezone: payload.timezone, dataFile: "data.json", dataSha256: sha256Buffer(json) }, null, 2);
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    output.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
  });
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);
  archive.append(manifest, { name: "manifest.json" });
  archive.append(json, { name: "data.json" });
  await archive.finalize();
  return done;
}

export async function createDatabaseSnapshot(db: DB, repository: Repository) {
  if (String(db.name) === ":memory:") throw new Error("内存数据库不能创建持久化快照");
  const backupDir = path.join(config.dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const id = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const rawDestination = path.join(backupDir, `${id}.db`);
  await db.backup(rawDestination);
  let destination = rawDestination;
  if (backupKey()) {
    destination = path.join(backupDir, `${id}.db.enc`);
    encryptSnapshot(rawDestination, destination);
    fs.rmSync(rawDestination);
  } else if (config.nodeEnv === "production") {
    fs.rmSync(rawDestination);
    throw new Error("生产环境创建 SQLite 备份前必须配置 BACKUP_ENCRYPTION_KEY");
  }
  const stat = fs.statSync(destination);
  const digest = sha256Buffer(fs.readFileSync(destination));
  const replica = replicateSnapshot(destination);
  const completedAt = new Date().toISOString();
  const status = replica.status === "VERIFIED" || (replica.status === "NOT_CONFIGURED" && config.nodeEnv !== "production") ? "PREPARED" : "REPLICA_FAILED";
  const note = [
    backupKey() ? "已创建 AES-256-GCM 加密的 SQLite 在线备份；恢复演练后才可标记 VERIFIED。" : "已创建本地 SQLite 在线备份；恢复演练后才可标记 VERIFIED。生产环境必须配置加密密钥。",
    replica.status === "NOT_CONFIGURED" ? "未配置异盘/异机复制；生产环境不能把本地文件视为完整备份。" : replica.status === "FAILED" ? "异盘/异机复制或目标校验失败。" : "异盘/异机复制哈希已复核。",
  ].join(" ");
  db.prepare("INSERT INTO backup_records (id, backup_type, file_path, file_size, sha256, format_version, encryption_key_version, started_at, completed_at, exit_code, replica_path, replica_sha256, replica_status, created_at, status, note) VALUES (?, 'sqlite_snapshot', ?, ?, ?, '1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, destination, stat.size, digest, backupKey() ? config.backupKeyVersion : null, startedAt, completedAt, status === "PREPARED" ? 0 : 2, replica.path, replica.sha256, replica.status, completedAt, status, note,
  );
  pruneBackups(db, backupDir);
  return { id, filePath: destination, fileSize: stat.size, sha256: digest, status, createdAt: completedAt, replica, note };
}

export function restoreSqliteSnapshot(snapshotPath: string, targetPath: string) {
  if (!fs.existsSync(snapshotPath)) throw new Error("SQLite 快照文件不存在");
  const restoreId = crypto.randomUUID();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempSource = path.join(path.dirname(targetPath), `.snapshot-source-${restoreId}.db`);
  const tempTarget = path.join(path.dirname(targetPath), `.snapshot-target-${restoreId}.db`);
  const sourceIsEncrypted = encryptedSnapshotOffset(fs.readFileSync(snapshotPath)) >= 0;
  try {
    if (sourceIsEncrypted) decryptSnapshot(snapshotPath, tempSource);
    else fs.copyFileSync(snapshotPath, tempSource);
    const sourceDb = new Database(tempSource, { readonly: true });
    const integrity = sourceDb.pragma("integrity_check", { simple: true });
    sourceDb.close();
    if (integrity !== "ok") throw new Error("SQLite 快照完整性检查失败");
    fs.copyFileSync(tempSource, tempTarget);
    const restoredDb = new Database(tempTarget);
    restoredDb.pragma("foreign_keys = ON");
    restoredDb.prepare("DELETE FROM trusted_device_sessions").run();
    restoredDb.prepare("UPDATE app_settings SET session_generation = session_generation + 1, updated_at = ? WHERE id = 1").run(new Date().toISOString());
    const restoredIntegrity = restoredDb.pragma("integrity_check", { simple: true });
    restoredDb.close();
    if (restoredIntegrity !== "ok") throw new Error("恢复后的 SQLite 完整性检查失败");
    const previousPath = `${targetPath}.before-restore-${restoreId}`;
    const movedFiles: Array<{ current: string; previous: string }> = [];
    try {
      for (const suffix of ["", "-wal", "-shm"]) {
        const current = `${targetPath}${suffix}`;
        const previous = `${previousPath}${suffix}`;
        if (fs.existsSync(current)) {
          fs.renameSync(current, previous);
          movedFiles.push({ current, previous });
        }
      }
      fs.renameSync(tempTarget, targetPath);
    } catch (error) {
      for (const { current, previous } of movedFiles.reverse()) {
        if (!fs.existsSync(current) && fs.existsSync(previous)) fs.renameSync(previous, current);
      }
      throw error;
    }
    return { previousPath, sourceWasEncrypted: sourceIsEncrypted, sessionReset: true };
  } finally {
    for (const filePath of [tempSource, tempTarget]) if (fs.existsSync(filePath)) fs.rmSync(filePath);
  }
}

export function recordSnapshotRestoreVerification(db: DB, snapshotPath: string, targetPath: string) {
  const stat = fs.statSync(snapshotPath);
  const digest = sha256Buffer(fs.readFileSync(snapshotPath));
  const verifiedAt = new Date().toISOString();
  const note = `SQLite 快照已恢复到 ${path.resolve(targetPath)}，并完成完整性与可信设备清除检查。`;
  const existing = db.prepare("SELECT id FROM backup_records WHERE sha256 = ? ORDER BY created_at DESC LIMIT 1").get(digest);
  if (existing) {
    db.prepare("UPDATE backup_records SET status = 'VERIFIED', verified_at = ?, completed_at = COALESCE(completed_at, ?), exit_code = 0, note = ? WHERE id = ?").run(verifiedAt, verifiedAt, note, existing.id);
    return existing.id;
  }
  const id = crypto.randomUUID();
  const encrypted = encryptedSnapshotOffset(fs.readFileSync(snapshotPath)) >= 0;
  db.prepare("INSERT INTO backup_records (id, backup_type, file_path, file_size, sha256, format_version, encryption_key_version, started_at, completed_at, exit_code, replica_status, created_at, verified_at, status, note) VALUES (?, 'sqlite_snapshot', ?, ?, ?, '1', ?, ?, ?, 0, 'NOT_APPLICABLE', ?, ?, 'VERIFIED', ?)").run(id, path.resolve(snapshotPath), stat.size, digest, encrypted ? config.backupKeyVersion : null, verifiedAt, verifiedAt, verifiedAt, verifiedAt, note);
  return id;
}

export function sendDownload(response: Response, buffer: Buffer, filename: string, contentType: string) {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.send(buffer);
}

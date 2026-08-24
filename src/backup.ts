import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PassThrough } from "node:stream";
import archiver from "archiver";
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

function encryptSnapshot(inputPath: string, outputPath: string) {
  const key = backupKey();
  if (!key) return false;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(fs.readFileSync(inputPath)), cipher.final()]);
  const authTag = cipher.getAuthTag();
  fs.writeFileSync(outputPath, Buffer.concat([Buffer.from("UADB1\n"), iv, authTag, encrypted]), { mode: 0o600 });
  return true;
}

export function exportJsonBuffer(repository: Repository) {
  const payload = repository.exportData();
  const dataBuffer = Buffer.from(JSON.stringify(payload.data));
  const enriched = {
    ...payload,
    manifest: {
      format: payload.format,
      formatVersion: payload.formatVersion,
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
  const manifest = JSON.stringify({ format: "uric-acid-export", formatVersion: "1", dataFile: "data.json", dataSha256: sha256Buffer(json) }, null, 2);
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
  const at = new Date().toISOString();
  db.prepare("INSERT INTO backup_records (id, backup_type, file_path, file_size, sha256, format_version, created_at, status) VALUES (?, 'sqlite_snapshot', ?, ?, ?, '1', ?, 'PREPARED')").run(id, destination, stat.size, digest, at);
  return { id, filePath: destination, fileSize: stat.size, sha256: digest, status: "PREPARED", createdAt: at, note: backupKey() ? "已创建 AES-256-GCM 加密的 SQLite 在线备份；恢复演练后才可标记 VERIFIED。" : "已创建本地 SQLite 在线备份；恢复演练后才可标记 VERIFIED。生产环境必须配置加密密钥。" };
}

export function sendDownload(response: Response, buffer: Buffer, filename: string, contentType: string) {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.send(buffer);
}

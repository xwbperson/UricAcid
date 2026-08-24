import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4317),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data")),
  passwordHash: loadPasswordHash(),
  passwordHashFile: path.resolve(process.env.SHARED_PASSWORD_HASH_FILE || path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "password.hash")),
  sessionDays: Number(process.env.SESSION_DAYS || 365),
  backupEncryptionKey: process.env.BACKUP_ENCRYPTION_KEY || "",
  backupKeyVersion: process.env.BACKUP_KEY_VERSION || "v1",
  backupReplicaDir: process.env.BACKUP_REPLICA_DIR ? path.resolve(process.env.BACKUP_REPLICA_DIR) : "",
  backupRetention: Math.max(1, Number(process.env.BACKUP_RETENTION || 7)),
  timezone: process.env.APP_TIMEZONE || "Asia/Shanghai",
};

function loadPasswordHash() {
  const filePath = path.resolve(process.env.SHARED_PASSWORD_HASH_FILE || path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "password.hash"));
  try {
    const fileHash = fs.readFileSync(filePath, "utf8").trim();
    if (fileHash) return fileHash;
  } catch {
    // The private file is optional during first-time setup.
  }
  return process.env.SHARED_PASSWORD_HASH || "";
}

export function persistPasswordHash(hash: string) {
  fs.mkdirSync(path.dirname(config.passwordHashFile), { recursive: true });
  fs.writeFileSync(config.passwordHashFile, `${hash}\n`, { encoding: "utf8", mode: 0o600 });
  config.passwordHash = hash;
}

export function isProduction() {
  return config.nodeEnv === "production";
}

import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config";
import { createDatabaseSnapshot, recordSnapshotRestoreVerification, restoreSqliteSnapshot } from "../src/backup";
import { closeDatabase, openDatabase } from "../src/db";
import { Repository } from "../src/repository";

async function main() {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) throw new Error("用法：npm run restore:snapshot -- <snapshot.db 或 snapshot.db.enc>");
  if (process.env.CONFIRM_RESTORE !== "RESTORE_URIC_ACID") throw new Error("这是破坏性操作，请设置 CONFIRM_RESTORE=RESTORE_URIC_ACID");
  const targetPath = path.join(config.dataDir, "app.db");
  if (fs.existsSync(targetPath)) {
    const currentDb = openDatabase(targetPath);
    try { await createDatabaseSnapshot(currentDb, new Repository(currentDb)); } finally { closeDatabase(currentDb); }
  }
  const result = restoreSqliteSnapshot(path.resolve(snapshotPath), targetPath);
  const checkDb = openDatabase(targetPath);
  try {
    const sessions = checkDb.prepare("SELECT COUNT(*) AS count FROM trusted_device_sessions").get().count;
    const verificationId = recordSnapshotRestoreVerification(checkDb, path.resolve(snapshotPath), targetPath);
    process.stdout.write(JSON.stringify({ ok: true, ...result, trustedDeviceSessions: sessions, verificationId }) + "\n");
  } finally {
    closeDatabase(checkDb);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

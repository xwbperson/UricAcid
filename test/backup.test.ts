import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../src/config";
import { createDatabaseSnapshot, recordSnapshotRestoreVerification, restoreSqliteSnapshot } from "../src/backup";
import { closeDatabase, openDatabase } from "../src/db";
import { Repository } from "../src/repository";

test("online snapshot records encryption, hash and verified replica state", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "uric-acid-backup-"));
  const previous = { dataDir: config.dataDir, nodeEnv: config.nodeEnv, encryptionKey: config.backupEncryptionKey, replicaDir: config.backupReplicaDir, keyVersion: config.backupKeyVersion };
  config.dataDir = directory;
  config.nodeEnv = "development";
  config.backupEncryptionKey = "test-only-key-material";
  config.backupKeyVersion = "test-v1";
  config.backupReplicaDir = path.join(directory, "replica");
  const db = openDatabase(path.join(directory, "app.db"));
  try {
    const result = await createDatabaseSnapshot(db, new Repository(db));
    assert.equal(result.status, "PREPARED");
    assert.equal(result.replica.status, "VERIFIED");
    assert.match(result.filePath, /\.db\.enc$/);
    assert.match(fs.readFileSync(result.filePath, "utf8").slice(0, 24), /^UADB1:test-v1\n/);
    const record = db.prepare("SELECT * FROM backup_records WHERE id = ?").get(result.id);
    assert.equal(record.encryption_key_version, "test-v1");
    assert.equal(record.replica_status, "VERIFIED");
    assert.equal(record.exit_code, 0);
    assert.equal(record.sha256, record.replica_sha256);
    closeDatabase(db);
    const targetPath = path.join(directory, "restored.db");
    const targetDb = openDatabase(targetPath);
    targetDb.prepare("INSERT INTO trusted_device_sessions (id, token_hash, csrf_hash, generation, created_at, expires_at, last_used_at) VALUES ('old', 'token', 'csrf', 1, ?, ?, ?)").run(new Date().toISOString(), new Date(Date.now() + 86400000).toISOString(), new Date().toISOString());
    closeDatabase(targetDb);
    const restoreResult = restoreSqliteSnapshot(result.filePath, targetPath);
    assert.equal(restoreResult.sessionReset, true);
    const restoredDb = openDatabase(targetPath);
    assert.equal(restoredDb.prepare("SELECT COUNT(*) AS count FROM trusted_device_sessions").get().count, 0);
    const verificationId = recordSnapshotRestoreVerification(restoredDb, result.filePath, targetPath);
    assert.equal(restoredDb.prepare("SELECT status FROM backup_records WHERE id = ?").get(verificationId).status, "VERIFIED");
    closeDatabase(restoredDb);
  } finally {
    if (db.open) closeDatabase(db);
    config.dataDir = previous.dataDir;
    config.nodeEnv = previous.nodeEnv;
    config.backupEncryptionKey = previous.encryptionKey;
    config.backupReplicaDir = previous.replicaDir;
    config.backupKeyVersion = previous.keyVersion;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

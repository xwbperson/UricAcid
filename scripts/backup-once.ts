import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config";
import { createDatabaseSnapshot } from "../src/backup";
import { closeDatabase, openDatabase } from "../src/db";
import { Repository } from "../src/repository";

async function main() {
  const dbPath = path.join(config.dataDir, "app.db");
  if (!fs.existsSync(dbPath)) throw new Error("数据库不存在，不能创建备份");
  const db = openDatabase(dbPath);
  try {
    const result = await createDatabaseSnapshot(db, new Repository(db));
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + "\n");
    if (result.status !== "PREPARED") throw new Error(`备份已生成但异机复制未验证：${result.status}`);
  } finally {
    closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

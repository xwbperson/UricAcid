import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config";

const dbPath = path.join(config.dataDir, "app.db");
if (!fs.existsSync(dbPath)) {
  console.log("数据库不存在，无需重置。");
  process.exit(0);
}
if (process.env.CONFIRM_RESET !== "URIC_ACID_RESET") {
  console.error("这是破坏性操作。请设置 CONFIRM_RESET=URIC_ACID_RESET 后重试。");
  process.exit(1);
}
for (const suffix of ["", "-wal", "-shm"]) {
  const target = `${dbPath}${suffix}`;
  if (fs.existsSync(target)) fs.rmSync(target);
}
console.log("数据库已删除；下一次启动会重新创建空数据空间和系统预置项。");

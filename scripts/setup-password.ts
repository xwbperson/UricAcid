import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { hashPassword } from "../src/auth";

const rl = readline.createInterface({ input, output });
async function main() {
  try {
    const first = await rl.question("设置共享访问口令（至少 8 个字符，不会写入日志）：");
    const second = await rl.question("再次输入以确认：");
    if (first !== second) throw new Error("两次输入不一致");
    const hash = hashPassword(first);
    if (process.env.NODE_ENV === "production") {
      const target = path.resolve(process.env.SHARED_PASSWORD_HASH_FILE || path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "password.hash"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${hash}\n`, { encoding: "utf8", mode: 0o600 });
      console.log("共享访问口令哈希已写入生产私密文件；明文未保存。");
    } else {
      const target = path.resolve(process.cwd(), ".env.local");
      const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
      const lines = existing.split(/\r?\n/).filter((line) => line && !line.startsWith("SHARED_PASSWORD_HASH="));
      lines.push(`SHARED_PASSWORD_HASH=${hash}`);
      fs.writeFileSync(target, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
      console.log("共享访问口令哈希已写入 .env.local；明文未保存。");
    }
  } finally {
    rl.close();
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });

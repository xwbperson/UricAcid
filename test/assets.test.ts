import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const publicDir = path.resolve(process.cwd(), "public");

function readPngSize(fileName: string) {
  const buffer = fs.readFileSync(path.join(publicDir, "icons", fileName));
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${fileName} must be a PNG`);
  assert.equal(buffer.toString("ascii", 12, 16), "IHDR", `${fileName} must contain a PNG header`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("brand icon assets and PWA declarations are complete", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#183b36");
  assert.deepEqual(manifest.icons.map((icon: { src: string; sizes: string; type: string }) => [icon.src, icon.sizes, icon.type]), [
    ["/icons/icon-192.png", "192x192", "image/png"],
    ["/icons/icon-512.png", "512x512", "image/png"],
  ]);

  assert.deepEqual(readPngSize("apple-touch-icon.png"), { width: 180, height: 180 });
  assert.deepEqual(readPngSize("icon-192.png"), { width: 192, height: 192 });
  assert.deepEqual(readPngSize("icon-512.png"), { width: 512, height: 512 });
  assert.deepEqual(readPngSize("favicon-16.png"), { width: 16, height: 16 });
  assert.deepEqual(readPngSize("favicon-32.png"), { width: 32, height: 32 });
  assert.ok(fs.existsSync(path.join(publicDir, "favicon.svg")));
  const ico = fs.readFileSync(path.join(publicDir, "favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 2);
  assert.equal(ico.readUInt8(6), 32);
  assert.equal(ico.readUInt8(22), 16);

  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  assert.match(html, /rel="apple-touch-icon"[^>]+sizes="180x180"/);
  assert.match(html, /rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="icon"[^>]+href="\/favicon\.svg"/);
  assert.match(html, /rel="alternate icon"[^>]+href="\/favicon\.ico"/);
});

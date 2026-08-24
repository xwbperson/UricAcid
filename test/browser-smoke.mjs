import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
const smokePassword = process.env.SMOKE_PASSWORD;
assert.ok(smokePassword, 'SMOKE_PASSWORD must be provided by the test runner');
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

try {
  await page.goto('http://127.0.0.1:4317', { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#gate').isVisible(), true);
  assert.match(await page.locator('#gate').innerText(), /共享访问口令/);

  await page.locator('#login-password').fill(smokePassword);
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('#app:not(.hidden)').waitFor();
  assert.match(await page.locator('#page-title').innerText(), /今日/);
  assert.equal(await page.locator('.quick-actions .action-card').count(), 4);

  await page.locator('[data-action="open-diet"][data-kind="food"]').click();
  await page.locator('.modal').waitFor();
  await page.locator('.picker-option').first().click();
  await page.locator('[data-form="diet"] [name="quantityG"]').fill('150');
  await page.locator('[data-form="diet"] button[type="submit"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.record-row').count() >= 1, true);

  await page.locator('[data-action="open-beverage"]').click();
  await page.locator('[data-form="beverage"] [name="beverageId"]').selectOption('bev-water');
  await page.locator('[data-form="beverage"] [name="amountMl"]').fill('500');
  await page.locator('[data-form="beverage"] [name="quantity"]').fill('2');
  await page.locator('[data-form="beverage"] button[type="submit"]').click();
  await page.waitForTimeout(250);
  assert.match(await page.locator('.view-container').innerText(), /1,?000/);

  await page.locator('[data-action="open-measurement"]').click();
  await page.locator('[data-form="measurement"] [name="valueOriginal"]').fill('7');
  await page.locator('[data-form="measurement"] [name="unitOriginal"]').selectOption('mg/dL');
  assert.match(await page.locator('.urate-preview').innerText(), /416\.36/);
  await page.locator('[data-form="measurement"]').evaluate((form) => form.requestSubmit());
  await page.waitForTimeout(700);

  await page.locator('.bottom-nav-item[data-route="stats"]').click();
  await page.locator('.panel').first().waitFor();
  assert.match(await page.locator('.view-container').innerText(), /血尿酸实测趋势/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.locator('.bottom-nav-item[data-route="manage"]').click();
  assert.match(await page.locator('.view-container').innerText(), /管理你的参考世界/);
  await page.locator('[data-action="manage-tab"][data-tab="settings"]').click();
  assert.match(await page.locator('.view-container').innerText(), /备份与迁移/);
  assert.match(await page.locator('.view-container').innerText(), /可信设备/);
  assert.equal(await page.locator('[data-action="download-csv"]').count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  fs.mkdirSync('test-artifacts', { recursive: true });
  await page.screenshot({ path: 'test-artifacts/mobile-manage.png', fullPage: true });
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  desktop.on('pageerror', (error) => consoleErrors.push(error.message));
  desktop.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await desktop.goto('http://127.0.0.1:4317', { waitUntil: 'networkidle' });
  if (await desktop.locator('#gate').isVisible()) {
    await desktop.locator('#login-password').fill(smokePassword);
    await desktop.locator('#login-form button[type="submit"]').click();
  }
  await desktop.locator('#app:not(.hidden)').waitFor();
  assert.equal(await desktop.locator('.sidebar').isVisible(), true);
  assert.equal(await desktop.locator('.bottom-nav').isVisible(), false);
  await desktop.locator('.nav-item[data-route="manage"]').click();
  assert.match(await desktop.locator('.view-container').innerText(), /管理你的参考世界/);
  assert.equal(await desktop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await desktop.close();
  assert.deepEqual(consoleErrors, []);
  console.log('browser smoke passed: mobile + desktop login, food, beverage, urate, stats, manage');
} finally {
  await browser.close();
}

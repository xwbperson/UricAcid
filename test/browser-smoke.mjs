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
page.on('dialog', (dialog) => dialog.accept());

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
  assert.equal(await page.locator('[data-action="manage-tab"][data-tab="group"]').count(), 0);
  await page.locator('[data-action="manage-tab"][data-tab="food"]').click();
  assert.equal(await page.locator('[data-group-manager="food"]').count(), 1);
  assert.match(await page.locator('[data-group-manager="food"]').innerText(), /食物分组/);
  const smokeGroupName = '烟测蔬菜分组';
  await page.locator('[data-group-manager="food"] [data-action="open-group-form"]').click();
  await page.locator('[data-form="group"] [name="name"]').fill(smokeGroupName);
  await page.locator('[data-form="group"] button[type="submit"]').click();
  await page.waitForTimeout(250);
  const smokeGroupId = await page.locator('[data-group-manager="food"] [data-action="open-group-form"][data-id]').getAttribute('data-id');
  assert.ok(smokeGroupId);
  const smokeFoodName = '烟测食物';
  await page.locator('[data-action="open-library-form"][data-type="food"]:not([data-id])').click();
  await page.locator('[data-form="library-food"] [name="name"]').fill(smokeFoodName);
  await page.locator('[data-form="library-food"] [name="groupId"]').selectOption(smokeGroupId);
  await page.locator('[data-form="library-food"] [name="purineLow"]').fill('20');
  await page.locator('[data-form="library-food"] [name="purineHigh"]').fill('30');
  await page.locator('[data-form="library-food"] button[type="submit"]').click();
  await page.waitForTimeout(250);
  const smokeFoodRow = page.locator('.library-item').filter({ hasText: smokeFoodName });
  assert.equal(await smokeFoodRow.count(), 1);
  await smokeFoodRow.locator('[data-action="delete-library-item"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.library-item').filter({ hasText: smokeFoodName }).count(), 0);
  const smokeGroupRow = page.locator('[data-group-manager="food"] .library-item').filter({ hasText: smokeGroupName });
  await smokeGroupRow.locator('[data-action="delete-group"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-group-manager="food"] .library-item').filter({ hasText: smokeGroupName }).count(), 0);
  await page.locator('[data-action="manage-tab"][data-tab="recipe"]').click();
  assert.equal(await page.locator('[data-group-manager="recipe"]').count(), 1);
  await page.locator('[data-action="manage-tab"][data-tab="beverage"]').click();
  assert.equal(await page.locator('[data-group-manager="beverage"]').count(), 1);
  await page.locator('[data-action="manage-tab"][data-tab="settings"]').click();
  assert.match(await page.locator('.view-container').innerText(), /备份与迁移/);
  assert.match(await page.locator('.view-container').innerText(), /可信设备/);
  assert.equal(await page.locator('[data-action="download-csv"]').count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  fs.mkdirSync('test-artifacts', { recursive: true });
  await page.screenshot({ path: 'test-artifacts/mobile-manage.png', fullPage: true });
  await page.locator('.bottom-nav-item[data-route="today"]').click();
  await page.locator('[data-action="delete-diet"]').first().click();
  await page.waitForTimeout(250);
  await page.locator('[data-action="delete-beverage"]').first().click();
  await page.waitForTimeout(250);
  await page.locator('[data-action="delete-measurement"]').first().click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-action="delete-diet"]').count(), 0);
  assert.equal(await page.locator('[data-action="delete-beverage"]').count(), 0);
  assert.equal(await page.locator('[data-action="delete-measurement"]').count(), 0);
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

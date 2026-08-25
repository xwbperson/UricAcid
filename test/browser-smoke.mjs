import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 1 });
const smokePassword = process.env.SMOKE_PASSWORD;
const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:4317';
assert.ok(smokePassword, 'SMOKE_PASSWORD must be provided by the test runner');
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('dialog', (dialog) => dialog.accept());

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#gate').isVisible(), true);
  assert.match(await page.locator('#gate').innerText(), /共享访问口令/);

  await page.locator('#login-password').fill(smokePassword);
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('#app:not(.hidden)').waitFor();
  await page.locator('.quick-actions .action-card').first().waitFor();
  assert.match(await page.locator('#page-title').innerText(), /今日/);
  assert.equal(await page.locator('.quick-actions .action-card').count(), 5);

  await page.locator('[data-action="open-diet"][data-kind="food"]').click();
  await page.locator('.modal').waitFor();
  await page.locator('.picker-option').first().click();
  await page.locator('[data-form="diet"] [name="quantityG"]').fill('150');
  await page.locator('[data-form="diet"] button[type="submit"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.record-row').count() >= 1, true);

  await page.locator('[data-action="open-diet"][data-kind="food"]').click();
  await page.locator('[data-form="diet"] .picker-search').fill('西兰花');
  await page.locator('[data-form="diet"] .picker-option').filter({ hasText: '西兰花' }).click();
  await page.locator('[data-form="diet"] [name="quantityG"]').fill('400');
  await page.locator('[data-form="diet"] button[type="submit"]').click();
  await page.waitForTimeout(250);
  assert.match(await page.locator('[data-guidance-panel]').innerText(), /400g/);
  assert.match(await page.locator('[data-guidance-panel]').innerText(), /接近提醒/);

  await page.locator('[data-action="open-beverage"]').click();
  await page.locator('[data-form="beverage"] [name="beverageId"]').selectOption('bev-water');
  await page.locator('[data-form="beverage"] [name="amountMl"]').fill('500');
  await page.locator('[data-form="beverage"] [name="quantity"]').fill('2');
  await page.locator('[data-form="beverage"] button[type="submit"]').click();
  await page.waitForTimeout(250);
  assert.match(await page.locator('.view-container').innerText(), /1,?000/);

  await page.locator('[data-action="open-beverage"]').click();
  await page.locator('[data-form="beverage"] [name="beverageId"]').selectOption('bev-water');
  await page.locator('[data-form="beverage"] [name="amountMl"]').fill('700');
  await page.locator('[data-form="beverage"] button[type="submit"]').click();
  await page.waitForTimeout(250);
  assert.match(await page.locator('[data-guidance-panel]').innerText(), /1,?700mL/);
  assert.match(await page.locator('[data-guidance-panel]').innerText(), /接近提醒/);

  await page.locator('[data-action="open-measurement"]').click();
  await page.locator('[data-form="measurement"] [name="valueOriginal"]').fill('7');
  await page.locator('[data-form="measurement"] [name="unitOriginal"]').selectOption('mg/dL');
  assert.match(await page.locator('.urate-preview').innerText(), /416\.36/);
  await page.locator('[data-form="measurement"]').evaluate((form) => form.requestSubmit());
  await page.waitForTimeout(700);

  await page.locator('[data-action="open-measurement"]').click();
  await page.locator('[data-form="measurement"] [name="valueOriginal"]').fill('535');
  await page.locator('[data-form="measurement"] [name="unitOriginal"]').selectOption('umol/L');
  await page.locator('[data-form="measurement"]').evaluate((form) => form.requestSubmit());
  await page.waitForTimeout(700);
  assert.match(await page.locator('[data-guidance-panel]').innerText(), /535/);
  assert.match(await page.locator('[data-guidance-panel]').innerText(), /复核提醒/);
  const treatmentKey = '烟测治疗' + Date.now();
  await page.locator('[data-action="open-treatment"]').click();
  await page.locator('[data-form="treatment"] [name="title"]').fill(treatmentKey + '检查');
  await page.locator('[data-form="treatment"] [name="eventType"]').selectOption('hospital_check');
  await page.locator('[data-form="treatment"] [name="facility"]:not([disabled])').fill('烟测医院');
  await page.locator('[data-form="treatment"] [name="testName"]').fill('烟测血尿酸');
  await page.locator('[data-action="add-treatment-result"]').click();
  await page.locator('[data-form="treatment"] [data-treatment-result-row] [name="testName"]').fill('血尿酸');
  await page.locator('[data-form="treatment"] [data-treatment-result-row] [name="resultText"]').fill('535 μmol/L');
  await page.locator('[data-form="treatment"] [data-treatment-result-row] [name="numericValue"]').fill('535');
  await page.locator('[data-form="treatment"] [data-treatment-result-row] [name="unit"]').fill('μmol/L');
  await page.locator('[data-form="treatment"] button[type="submit"]').click();
  await page.waitForTimeout(350);

  await page.locator('[data-action="open-treatment"]').click();
  await page.locator('[data-form="treatment"] [name="title"]').fill(treatmentKey + '外用');
  await page.locator('[data-form="treatment"] [name="eventType"]').selectOption('topical_medication');
  await page.locator('[data-form="treatment"] [name="medicineName"]').fill('烟测外用药');
  await page.locator('[data-form="treatment"] [name="applicationSite"]').fill('右脚');
  await page.locator('[data-form="treatment"] button[type="submit"]').click();
  await page.waitForTimeout(350);

  await page.locator('[data-action="open-treatment"]').click();
  await page.locator('[data-form="treatment"] [name="title"]').fill(treatmentKey + '变化');
  await page.locator('[data-form="treatment"] [name="eventType"]').selectOption('symptom_change');
  await page.locator('[data-form="treatment"] [name="symptomState"]').selectOption('缓解');
  await page.locator('[data-form="treatment"] [name="symptomDescription"]').fill('红肿减轻');
  await page.locator('[data-form="treatment"] button[type="submit"]').click();
  await page.waitForTimeout(350);

  await page.locator('.bottom-nav-item[data-route="treatment"]').click();
  await page.locator('[data-form="treatment-filter"] [name="q"]').fill(treatmentKey);
  await page.locator('[data-form="treatment-filter"] button[type="submit"]').click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.treatment-event-card').count(), 3);
  assert.match(await page.locator('.treatment-timeline-panel').innerText(), /医院检查/);
  assert.match(await page.locator('.treatment-timeline-panel').innerText(), /外用药/);
  assert.match(await page.locator('.treatment-timeline-panel').innerText(), /症状变化/);
  assert.match(await page.locator('.treatment-timeline-panel').innerText(), /535 μmol\/L/);
  await page.locator('[data-form="treatment-filter"] [name="type"]').selectOption('topical_medication');
  await page.locator('[data-form="treatment-filter"] button[type="submit"]').click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.treatment-event-card').count(), 1);
  assert.match(await page.locator('.treatment-timeline-panel').innerText(), /烟测外用药/);
  assert.equal(await page.locator('[data-form="treatment-filter"] [name="from"]').inputValue(), '');
  assert.equal(await page.locator('[data-form="treatment-filter"] [name="to"]').inputValue(), '');
  await page.locator('[data-action="clear-treatment-filters"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-form="treatment-filter"] [name="q"]').inputValue(), '');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  fs.mkdirSync('test-artifacts', { recursive: true });
  await page.screenshot({ path: 'test-artifacts/mobile-treatment.png', fullPage: true });

  await page.locator('.bottom-nav-item[data-route="stats"]').click();
  await page.getByText('血尿酸实测趋势', { exact: true }).waitFor();
  assert.match(await page.locator('.view-container').innerText(), /血尿酸实测趋势/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.locator('.bottom-nav-item[data-route="manage"]').click();
  await page.getByText(/管理你的参考世界/).waitFor();
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
  await page.locator(`[data-group-manager="food"] [data-action="manage-group-filter"][data-group-id="${smokeGroupId}"]`).click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-library-group-filter="food"]').inputValue(), smokeGroupId);
  assert.equal(await page.locator('[data-library-list="food"] .library-item').count(), 1);
  const smokeFoodRow = page.locator('[data-library-list="food"] .library-item').filter({ hasText: smokeFoodName });
  assert.equal(await smokeFoodRow.count(), 1);
  await smokeFoodRow.locator('[data-action="delete-library-item"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-library-list="food"] .library-item').filter({ hasText: smokeFoodName }).count(), 0);
  const smokeGroupRow = page.locator('[data-group-manager="food"] .library-item').filter({ hasText: smokeGroupName });
  await smokeGroupRow.locator('[data-action="delete-group"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[data-group-manager="food"] .library-item').filter({ hasText: smokeGroupName }).count(), 0);
  await page.locator('[data-action="manage-tab"][data-tab="recipe"]').click();
  assert.equal(await page.locator('[data-group-manager="recipe"]').count(), 1);
  assert.match(await page.locator('[data-library-list="recipe"]').innerText(), /番茄炒蛋/);
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
  while (await page.locator('[data-action="delete-diet"]').count()) {
    await page.locator('[data-action="delete-diet"]').first().click();
    await page.waitForTimeout(250);
  }
  while (await page.locator('[data-action="delete-beverage"]').count()) {
    await page.locator('[data-action="delete-beverage"]').first().click();
    await page.waitForTimeout(250);
  }
  while (await page.locator('[data-action="delete-measurement"]').count()) {
    await page.locator('[data-action="delete-measurement"]').first().click();
    await page.waitForTimeout(250);
  }
  await page.locator('.bottom-nav-item[data-route="treatment"]').click();
  await page.locator('[data-form="treatment-filter"] [name="q"]').fill(treatmentKey);
  await page.locator('[data-form="treatment-filter"] button[type="submit"]').click();
  await page.waitForTimeout(250);
  while (await page.locator('[data-action="delete-treatment"]').count()) {
    await page.locator('[data-action="delete-treatment"]').first().click();
    await page.waitForTimeout(250);
  }
  assert.equal(await page.locator('[data-action="delete-diet"]').count(), 0);
  assert.equal(await page.locator('[data-action="delete-beverage"]').count(), 0);
  assert.equal(await page.locator('[data-action="delete-measurement"]').count(), 0);
  assert.equal(await page.locator('[data-action="delete-treatment"]').count(), 0);
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  desktop.on('pageerror', (error) => consoleErrors.push(error.message));
  desktop.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await desktop.goto(baseUrl, { waitUntil: 'networkidle' });
  if (await desktop.locator('#gate').isVisible()) {
    await desktop.locator('#login-password').fill(smokePassword);
    await desktop.locator('#login-form button[type="submit"]').click();
  }
  await desktop.locator('#app:not(.hidden)').waitFor();
  assert.equal(await desktop.locator('.sidebar').isVisible(), true);
  assert.equal(await desktop.locator('.bottom-nav').isVisible(), false);
  await desktop.locator('.nav-item[data-route="manage"]').click();
  assert.match(await desktop.locator('.view-container').innerText(), /管理你的参考世界/);
  await desktop.locator('[data-action="manage-tab"][data-tab="food"]').click();
  const scrollResult = await desktop.locator('.manage-library-layout').evaluate((layout) => {
    const panels = [...layout.querySelectorAll(':scope > .panel')];
    const left = panels[0];
    const right = panels[1];
    const leftScrollable = left.scrollHeight > left.clientHeight;
    const rightScrollable = right.scrollHeight > right.clientHeight;
    const rightBefore = right.scrollTop;
    left.scrollTop = left.scrollHeight;
    const rightUnchangedAfterLeftScroll = right.scrollTop === rightBefore;
    const leftAtBottom = Math.abs(left.scrollTop - (left.scrollHeight - left.clientHeight)) <= 1;
    right.scrollTop = right.scrollHeight;
    const leftStayedAtBottom = Math.abs(left.scrollTop - (left.scrollHeight - left.clientHeight)) <= 1;
    return { leftScrollable, rightScrollable, rightUnchangedAfterLeftScroll, leftAtBottom, leftStayedAtBottom };
  });
  assert.equal(scrollResult.leftScrollable, true);
  assert.equal(scrollResult.rightScrollable, true);
  assert.equal(scrollResult.rightUnchangedAfterLeftScroll, true);
  assert.equal(scrollResult.leftAtBottom, true);
  assert.equal(scrollResult.leftStayedAtBottom, true);
  assert.equal(await desktop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await desktop.close();
  assert.deepEqual(consoleErrors, []);
  console.log('browser smoke passed: mobile + desktop login, food, beverage, urate, stats, manage');
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const baseUrl = process.env.HISTORY_SMOKE_BASE_URL || 'http://127.0.0.1:4317';
const historyFixture = {
  date: '2026-08-25',
  dietEntries: [{ id: 'food-1' }, { id: 'food-2' }],
  beverageEntries: [{ id: 'drink-1' }],
  measurements: [{ id: 'urate-1' }],
  treatmentEventCount: 1,
  summary: { low: 596.3, high: 596.3 },
  beverage: { totalMl: 1700 },
};

async function installApiFixture(page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = path === '/api/auth/status'
      ? { configured: true, authenticated: true, csrfToken: 'history-smoke-csrf' }
      : path === '/api/bootstrap'
        ? { settings: { timezone: 'Asia/Shanghai', defaultUrateUnit: 'umol/L', waterGoalMl: null } }
        : path === '/api/auth/sessions'
          ? { sessions: [] }
          : path === '/api/day'
            ? { date: historyFixture.date, summary: { totalCount: 0, low: null, high: null }, dietEntries: [], beverageEntries: [], measurements: [], treatmentEvents: [], treatmentEventCount: 0, beverage: { totalMl: 0, plainWaterMl: 0, otherMl: 0 } }
            : path === '/api/history'
              ? { days: [historyFixture] }
              : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

async function inspect(viewport) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await installApiFixture(page);
  await page.goto(`${baseUrl}/#history`, { waitUntil: 'networkidle' });
  await page.locator('.history-day').waitFor();
  const metrics = await page.locator('.history-day').evaluate((card) => {
    const cardStyle = getComputedStyle(card);
    const panel = card.closest('.panel');
    const cardRect = card.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      display: cardStyle.display,
      background: cardStyle.backgroundColor,
      gridColumns: cardStyle.gridTemplateColumns,
      cardWidth: Math.round(cardRect.width),
      panelWidth: Math.round(panelRect.width),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      arrowVisible: card.querySelector(':scope > .history-day-arrow').getBoundingClientRect().width > 0,
    };
  });
  fs.mkdirSync('test-artifacts', { recursive: true });
  await page.screenshot({ path: `test-artifacts/history-card-${viewport.width}.png`, fullPage: true });
  await browser.close();
  return metrics;
}

const desktop = await inspect({ width: 1280, height: 800 });
assert.equal(desktop.display, 'grid');
assert.notEqual(desktop.background, 'rgb(239, 239, 239)');
assert.notEqual(desktop.gridColumns, 'none');
assert.equal(desktop.arrowVisible, true);
assert.equal(desktop.overflow, false);
  assert.equal(desktop.cardWidth > desktop.panelWidth * 0.8, true);

const mobile = await inspect({ width: 360, height: 800 });
assert.equal(mobile.display, 'grid');
assert.equal(mobile.overflow, false);
assert.equal(mobile.cardWidth > mobile.panelWidth * 0.8, true);

console.log(JSON.stringify({ desktop, mobile }));

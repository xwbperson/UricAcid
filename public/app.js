const state = {
  csrf: null,
  status: null,
  bootstrap: null,
  day: null,
  stats: null,
  history: null,
  sessions: [],
  currentDate: todayIso(),
  route: location.hash.replace('#', '') || 'today',
  statsPeriod: '30',
  manageTab: 'food',
  modalContext: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function formatRange(low, high, unit = 'mg') {
  if (low === null || high === null || low === undefined || high === undefined) return '暂无估算';
  const left = formatNumber(low, 3); const right = formatNumber(high, 3);
  return Number(low) === Number(high) ? `约 ${left}${unit}` : `${left}–${right}${unit}`;
}

function formatDate(date, withWeek = true) {
  if (!date) return '—';
  const parsed = new Date(`${date}T00:00:00`);
  const week = ['日', '一', '二', '三', '四', '五', '六'][parsed.getDay()];
  return withWeek ? `${date.replaceAll('-', '.')} 周${week}` : date.replaceAll('-', '.');
}

function formatUrate(valueUmolL) {
  if (valueUmolL === null || valueUmolL === undefined) return '—';
  const unit = state.bootstrap?.settings?.defaultUrateUnit || 'umol/L';
  const value = unit === 'mg/dL' ? Number(valueUmolL) / 59.48 : Number(valueUmolL);
  return `${formatNumber(value, 2)} ${unit === 'mg/dL' ? 'mg/dL' : 'μmol/L'}`;
}

function showToast(message, kind = 'info') {
  const region = $('#toast-region');
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 3600);
}

async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (state.csrf && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    if (response.status === 401) showGate('设备凭证已失效，请重新输入共享访问口令');
    const message = body?.error || '请求失败，请稍后重试';
    throw new Error(message);
  }
  return body;
}

async function refreshSession() {
  const status = await api('/api/auth/status');
  state.status = status;
  state.csrf = status.csrfToken || null;
  return status;
}

async function loadData() {
  $('#save-status').textContent = '同步中…';
  const [bootstrap, day, sessions] = await Promise.all([
    api('/api/bootstrap'),
    api(`/api/day?date=${encodeURIComponent(state.currentDate)}`),
    api('/api/auth/sessions'),
  ]);
  state.bootstrap = bootstrap;
  state.day = day;
  state.sessions = sessions.sessions || [];
  $('#save-status').textContent = '已连接';
}

async function loadRouteData() {
  if (state.route === 'today') {
    state.day = await api(`/api/day?date=${encodeURIComponent(state.currentDate)}`);
  } else if (state.route === 'history') {
    state.history = (await api(`/api/history?from=${encodeURIComponent(addDays(state.currentDate, -29))}&to=${encodeURIComponent(state.currentDate)}`)).days;
  } else if (state.route === 'stats') {
    let from = addDays(state.currentDate, -29);
    if (state.statsPeriod === '90') from = addDays(state.currentDate, -89);
    if (state.statsPeriod === '365') from = addDays(state.currentDate, -364);
    if (state.statsPeriod === 'all') from = '2000-01-01';
    state.stats = await api(`/api/statistics?from=${from}&to=${state.currentDate}`);
  }
}

function setRoute(route) {
  state.route = route;
  if (location.hash !== `#${route}`) location.hash = route;
  $$('.nav-item, .bottom-nav-item').forEach((item) => item.classList.toggle('active', item.dataset.route === route));
  const meta = {
    today: ['TODAY / DAILY LOG', '今日'],
    history: ['HISTORY / DAY BY DAY', '历史'],
    stats: ['STATISTICS / OBSERVATION', '统计'],
    manage: ['MANAGE / YOUR SOURCES', '管理'],
  }[route] || ['TODAY / DAILY LOG', '今日'];
  $('#page-kicker').textContent = meta[0]; $('#page-title').textContent = meta[1];
  $('#sidebar')?.classList.remove('open');
  renderCurrentRoute();
}

async function renderCurrentRoute() {
  if (!state.bootstrap) return;
  try {
    await loadRouteData();
    const view = $('#view');
    if (state.route === 'today') view.innerHTML = renderToday();
    if (state.route === 'history') view.innerHTML = renderHistory();
    if (state.route === 'stats') view.innerHTML = renderStats();
    if (state.route === 'manage') view.innerHTML = renderManage();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function coverageBadge(summary) {
  if (!summary || summary.totalCount === 0) return '<span class="coverage-badge empty">尚无食物记录</span>';
  return summary.coverage === 'partial'
    ? `<span class="coverage-badge partial">部分覆盖 · ${summary.unknownCount} 项暂无参考</span>`
    : '<span class="coverage-badge">已覆盖记录</span>';
}

function renderToday() {
  const day = state.day;
  const summary = day.summary;
  const latest = day.latestMeasurement;
  const allEntries = [
    ...day.dietEntries.map((entry) => ({ ...entry, type: 'diet', timestamp: entry.createdAt })),
    ...day.beverageEntries.map((entry) => ({ ...entry, type: 'beverage', timestamp: entry.createdAt })),
    ...day.measurements.map((entry) => ({ ...entry, type: 'urate', timestamp: `${entry.date}T${entry.time || '23:59'}` })),
  ].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return `
    <div class="page-intro">
      <div><p class="eyebrow">DAILY TRACE / ${escapeHtml(day.date)}</p><h3>今天，先记下来。</h3><p>记录是观察的起点；不知道的部分，就让它保持未知。</p></div>
      <div class="date-control"><button class="date-arrow" data-action="shift-date" data-days="-1" aria-label="前一天">‹</button><input id="day-date" type="date" value="${escapeHtml(day.date)}" /><button class="date-arrow" data-action="shift-date" data-days="1" aria-label="后一天">›</button></div>
    </div>
    <div class="hero-grid">
      <article class="hero-card primary"><span class="card-kicker">ESTIMATED PURINE / ${escapeHtml(day.date)}</span><h3>今日膳食嘌呤估算</h3><div class="hero-number"><strong>${summary.totalCount ? formatRange(summary.low, summary.high, '') : '—'}</strong><span>${summary.totalCount ? 'mg' : ''}</span></div><div class="hero-foot">${coverageBadge(summary)}<small>${summary.totalCount ? `${summary.totalCount} 条饮食记录${summary.unknownCount ? ` · ${summary.unknownCount} 条未参与估算` : ''}` : '没有记录不等于摄入量为 0'}</small></div></article>
      <article class="hero-card"><span class="card-kicker">BEVERAGE / mL</span><h3>饮品总量</h3><div class="hero-number"><strong>${formatNumber(day.beverage.totalMl, 0)}</strong><span>mL</span></div><div class="hero-foot"><small>纯净水 ${formatNumber(day.beverage.plainWaterMl, 0)} mL<br/>其他饮品 ${formatNumber(day.beverage.otherMl, 0)} mL</small></div></article>
      <article class="hero-card"><span class="card-kicker">MEASUREMENT / LAST</span><h3>最近一次实测</h3><div class="hero-number"><strong>${latest ? formatUrate(latest.valueUmolL).split(' ')[0] : '—'}</strong><span>${latest ? formatUrate(latest.valueUmolL).split(' ').slice(1).join(' ') : ''}</span></div><div class="hero-foot"><small>${latest ? `${formatDate(latest.date, false)} · 真实测量` : '还没有血尿酸记录'}</small></div></article>
    </div>
    <div class="quick-actions"><button class="action-card" data-action="open-diet" data-kind="food"><span class="action-icon">＋</span><strong>记录食物</strong><small>克数 · 参考范围</small></button><button class="action-card" data-action="open-diet" data-kind="recipe"><span class="action-icon">⌁</span><strong>记录菜谱</strong><small>成品克数 · 快速选择</small></button><button class="action-card" data-action="open-beverage"><span class="action-icon">◒</span><strong>记录饮品</strong><small>容量 · 可选数量</small></button><button class="action-card" data-action="open-measurement"><span class="action-icon">↗</span><strong>记录尿酸</strong><small>实测值 · 原始单位</small></button></div>
    <div class="info-strip">本页估算的是膳食嘌呤摄入负荷，不是个人血尿酸升高值，也不用于诊断或治疗。饮品容量单独统计，不抵扣嘌呤负荷。</div>
    <div class="section-heading"><h4>今天的记录</h4><small>${allEntries.length ? `${allEntries.length} 条 · 按时间倒序` : '从第一条记录开始'}</small></div>
    <div class="record-list">${allEntries.length ? allEntries.map(renderRecordRow).join('') : '<div class="empty-state"><strong>这一天还很安静</strong><span>用上面的入口记录第一条饮食、饮品或尿酸实测。</span></div>'}</div>`;
}

function renderRecordRow(entry) {
  if (entry.type === 'diet') return `<div class="record-row"><span class="record-marker"></span><div class="record-main"><strong>${escapeHtml(entry.name)}</strong><small>${entry.kind === 'recipe' ? '菜谱' : '食物'} · ${formatNumber(entry.quantityG, 1)}g${entry.groupName ? ` · ${escapeHtml(entry.groupName)}` : ''}</small></div><div class="record-value">${formatRange(entry.contributionLow, entry.contributionHigh)}<small>${entry.contributionLow === null ? '暂无估算' : '录入时快照'}</small></div><div class="row-actions"><button data-action="edit-diet" data-id="${escapeHtml(entry.id)}" data-kind="${escapeHtml(entry.kind)}" aria-label="编辑">编辑</button><button data-action="delete-diet" data-id="${escapeHtml(entry.id)}" aria-label="删除">删除</button></div></div>`;
  if (entry.type === 'beverage') return `<div class="record-row"><span class="record-marker beverage"></span><div class="record-main"><strong>${escapeHtml(entry.name)}</strong><small>饮品 · ${entry.quantity > 1 ? `${entry.amountMl / entry.quantity}mL × ${entry.quantity}` : `${entry.amountMl}mL`}</small></div><div class="record-value">${formatNumber(entry.amountMl, 0)}<small>mL · 不抵扣嘌呤</small></div><div class="row-actions"><button data-action="edit-beverage" data-id="${escapeHtml(entry.id)}">编辑</button><button data-action="delete-beverage" data-id="${escapeHtml(entry.id)}">删除</button></div></div>`;
  return `<div class="record-row"><span class="record-marker urate"></span><div class="record-main"><strong>血尿酸实测</strong><small>${escapeHtml(entry.time || '仅记录日期')} · ${escapeHtml(entry.sourceKind || '来源未填')}</small></div><div class="record-value">${formatUrate(entry.valueUmolL)}<small>原始 ${formatNumber(entry.valueOriginal, 2)} ${escapeHtml(entry.unitOriginal)}</small></div><div class="row-actions"><button data-action="edit-measurement" data-id="${escapeHtml(entry.id)}">编辑</button><button data-action="delete-measurement" data-id="${escapeHtml(entry.id)}">删除</button></div></div>`;
}

function renderHistory() {
  const days = state.history || [];
  return `<div class="page-intro"><div><p class="eyebrow">DAY BY DAY / HISTORY</p><h3>给过去留一页。</h3><p>未记录的日期显示为空，不会被当作 0。</p></div><div class="date-control"><span>回看到</span><input id="history-date" type="date" value="${escapeHtml(state.currentDate)}" /></div></div><div class="panel"><div class="panel-header"><div><h4>最近 30 天</h4><p>饮食、饮品和实测共用真实日期；点开日期可继续修改。</p></div><span class="mono">${days.length} DAYS WITH DATA</span></div>${days.length ? `<div class="history-list">${days.map((day) => `<button class="history-day" data-action="open-history-day" data-date="${escapeHtml(day.date)}"><div><strong>${formatDate(day.date)}</strong><small>${day.dietEntries.length} 条饮食 · ${day.beverageEntries.length} 条饮品 · ${day.measurements.length} 条实测</small></div><div class="history-day-right"><strong>${formatRange(day.summary.low, day.summary.high)}</strong><small>${formatNumber(day.beverage.totalMl, 0)}mL 饮品</small></div><span>›</span></button>`).join('')}</div>` : '<div class="empty-state"><strong>这段时间还没有记录</strong><span>切换到今日，先留下一条可回看的证据。</span></div>'}</div>`;
}

function renderStats() {
  const stats = state.stats || { measurements: [], daily: [], urateStats: {} };
  const measurements = stats.measurements || [];
  const latest = stats.urateStats?.latest;
  const previous = stats.urateStats?.previous;
  const diff = latest && previous ? latest.valueUmolL - previous.valueUmolL : null;
  const interval = latest && previous ? Math.round((Date.parse(`${latest.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86400000) : null;
  const dailyRows = stats.daily || [];
  const beverageTotal = dailyRows.reduce((sum, row) => sum + (row.beverageTotalMl || 0), 0);
  const plainWaterTotal = dailyRows.reduce((sum, row) => sum + (row.plainWaterMl || 0), 0);
  const otherBeverageTotal = beverageTotal - plainWaterTotal;
  return `<div class="page-intro"><div><p class="eyebrow">OBSERVATION / NO CAUSAL CLAIMS</p><h3>看见变化，也保留边界。</h3><p>独立展示实测、膳食负荷和饮品容量；同期记录不能证明因果。</p></div><div class="period-switch">${[['30', '近 30 天'], ['90', '近 90 天'], ['365', '近 1 年'], ['all', '全部']].map(([value, label]) => `<button class="chip ${state.statsPeriod === value ? 'active' : ''}" data-action="stats-period" data-period="${value}">${label}</button>`).join('')}</div></div><div class="stat-layout"><section class="panel"><div class="panel-header"><div><h4>血尿酸实测趋势</h4><p>规范单位先统一为 μmol/L；记录详情仍保留原始单位。</p></div><span class="mono">${measurements.length} MEASUREMENTS</span></div><div class="metric-trio metrics-wide"><div><small>最新</small><strong>${latest ? formatUrate(latest.valueUmolL) : '—'}</strong></div><div><small>上一次 / 间隔</small><strong>${previous ? `${formatUrate(previous.valueUmolL)} · ${interval}天` : '—'}</strong></div><div><small>两次差值</small><strong>${diff === null ? '—' : `${diff >= 0 ? '+' : ''}${formatNumber(diff, 2)} μmol/L`}</strong></div><div><small>记录数</small><strong>${stats.urateStats?.count || 0}</strong></div><div><small>最小 / 最大</small><strong>${stats.urateStats?.min === null || stats.urateStats?.min === undefined ? '—' : `${formatNumber(stats.urateStats.min, 1)} / ${formatNumber(stats.urateStats.max, 1)}`}</strong></div><div><small>中位数</small><strong>${stats.urateStats?.median === null || stats.urateStats?.median === undefined ? '—' : formatUrate(stats.urateStats.median)}</strong></div></div>${renderLineChart(measurements)}<div class="section-heading"><h4>可读数据表</h4><small>按测量日期，不补齐缺测日</small></div>${measurements.length ? `<table class="data-table"><thead><tr><th>日期</th><th>原始值</th><th>规范值</th></tr></thead><tbody>${measurements.slice().reverse().map((row) => `<tr><td>${formatDate(row.date, false)}</td><td>${formatNumber(row.valueOriginal, 2)} ${escapeHtml(row.unitOriginal)}</td><td>${formatNumber(row.valueUmolL, 2)} μmol/L</td></tr>`).join('')}</tbody></table>` : '<div class="chart-empty">还没有实测数据</div>'}</section><section class="panel"><div class="panel-header"><div><h4>饮食与饮品趋势</h4><p>只呈现实际有记录的天；不把空白当作 0。</p></div><span class="mono">${stats.recordedDays || 0} / ${stats.totalDays || 0} DAYS</span></div><div class="metric-trio metrics-wide"><div><small>区间饮品</small><strong>${formatNumber(beverageTotal, 0)}mL</strong></div><div><small>纯净水</small><strong>${formatNumber(plainWaterTotal, 0)}mL</strong></div><div><small>其他饮品</small><strong>${formatNumber(otherBeverageTotal, 0)}mL</strong></div></div>${renderBarChart(stats.daily)}<div class="section-heading"><h4>日数据</h4><small>嘌呤范围 · 饮品总量 · 纯净水 · 其他饮品</small></div>${stats.daily?.length ? `<table class="data-table"><thead><tr><th>日期</th><th>嘌呤</th><th>饮品</th><th>纯水</th><th>其他</th></tr></thead><tbody>${stats.daily.slice().reverse().map((row) => `<tr><td>${formatDate(row.date, false)}</td><td>${formatRange(row.purineLow, row.purineHigh)}</td><td>${formatNumber(row.beverageTotalMl, 0)}mL</td><td>${formatNumber(row.plainWaterMl, 0)}mL</td><td>${formatNumber((row.beverageTotalMl || 0) - (row.plainWaterMl || 0), 0)}mL</td></tr>`).join('')}</tbody></table>` : '<div class="chart-empty">还没有饮食或饮品趋势</div>'}</section></div><section class="panel" style="margin-top:14px"><div class="panel-header"><div><h4>同期记录对照</h4><p>每次实测前的 1 / 3 / 7 个完整日；只展示同一时间窗中的记录。</p></div><span class="mono">CONTEXT ONLY</span></div>${stats.comparisons?.length ? `<div class="comparison-list">${stats.comparisons.slice().reverse().map((item) => `<div class="comparison-row"><header><span>${formatDate(item.measurement.date)} 实测 ${formatUrate(item.measurement.valueUmolL)}</span><span>不能证明因果</span></header><div class="comparison-windows">${item.windows.map((window) => `<div class="comparison-window"><small>前 ${window.days} 日 · ${window.totalCount ? window.coverage : '无饮食记录'}</small><strong>${formatRange(window.low, window.high)}</strong><small>${formatNumber(window.beverageTotalMl, 0)}mL · 纯水 ${formatNumber(window.plainWaterMl, 0)}mL · ${window.recordedDays} 天有记录</small></div>`).join('')}</div></div>`).join('')}</div>` : '<div class="empty-state"><strong>有了尿酸实测，才会出现同期回看</strong><span>这个区域不会替你生成因果结论。</span></div>'}</section><div class="info-strip" style="margin-top:14px">以下为同期记录，仅供自我观察；它不能证明某种食物或饮品导致本次血尿酸变化。</div>`;
}

function renderLineChart(rows) {
  if (!rows.length) return '<div class="chart-empty">记录 1 次可以看到单点；至少 2 次才有变化趋势。</div>';
  const width = 640; const height = 215; const pad = { left: 32, right: 14, top: 18, bottom: 28 };
  const values = rows.map((row) => row.valueUmolL); const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 20;
  const firstDay = Date.parse(`${rows[0].date}T00:00:00Z`); const lastDay = Date.parse(`${rows.at(-1).date}T00:00:00Z`); const daySpan = Math.max(1, Math.round((lastDay - firstDay) / 86400000));
  const points = rows.map((row) => { const dayOffset = Math.max(0, Math.round((Date.parse(`${row.date}T00:00:00Z`) - firstDay) / 86400000)); const x = pad.left + (rows.length === 1 ? (width - pad.left - pad.right) / 2 : dayOffset / daySpan * (width - pad.left - pad.right)); const y = pad.top + (max - row.valueUmolL) / spread * (height - pad.top - pad.bottom); return { x, y, row }; });
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  return `<div class="chart-wrap"><svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="血尿酸实测趋势图"><line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top}" y2="${pad.top}"/><line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${height / 2}" y2="${height / 2}"/><line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"/><text x="0" y="${pad.top + 4}" fill="#7e847b" font-size="10">${formatNumber(max, 0)}</text><text x="0" y="${height - pad.bottom + 4}" fill="#7e847b" font-size="10">${formatNumber(min, 0)}</text><path class="trend-line" d="${path}"/>${points.map((point) => `<circle class="trend-dot" cx="${point.x}" cy="${point.y}" r="5"><title>${point.row.date} ${formatUrate(point.row.valueUmolL)}</title></circle>`).join('')}<text x="${pad.left}" y="${height - 5}" fill="#7e847b" font-size="9">${rows[0].date}</text><text text-anchor="end" x="${width - pad.right}" y="${height - 5}" fill="#7e847b" font-size="9">${rows.at(-1).date}</text></svg></div>`;
}

function renderBarChart(rows) {
  if (!rows?.length) return '<div class="chart-empty">有记录后会显示每日区间。</div>';
  const max = Math.max(...rows.map((row) => row.purineHigh || 0), 1);
  return `<div class="bar-chart">${rows.slice(-14).map((row) => `<div class="bar-column"><div class="bar" style="height:${Math.max(3, ((row.purineHigh || 0) / max) * 145)}px" title="${formatRange(row.purineLow, row.purineHigh)}"></div><small>${row.date.slice(5)}</small></div>`).join('')}</div>`;
}

function renderManage() {
  const tabs = [['food', '食物'], ['recipe', '菜谱'], ['beverage', '饮品'], ['settings', '设置与数据']];
  const tabHtml = tabs.map(([key, label]) => `<button class="chip ${state.manageTab === key ? 'active' : ''}" data-action="manage-tab" data-tab="${key}">${label}</button>`).join('');
  let content = '';
  if (state.manageTab === 'food') content = renderFoodLibrary();
  if (state.manageTab === 'recipe') content = renderRecipeLibrary();
  if (state.manageTab === 'beverage') content = renderBeverageLibrary();
  if (state.manageTab === 'settings') content = renderSettingsLibrary();
  return `<div class="page-intro"><div><p class="eyebrow">LIBRARY / SMALL, TRACEABLE, YOURS</p><h3>管理你的参考世界。</h3><p>版本发布后不覆盖历史快照；待复核资料会一直带着自己的状态。</p></div></div><div class="management-tabs">${tabHtml}</div>${content}`;
}

function renderFoodLibrary() {
  return `<div class="manage-layout"><section class="panel"><div class="panel-header"><div><h4>食物参考库</h4><p>当前 ${state.bootstrap.counts.foods} 项可选；“待复核”不是 VERIFIED。</p></div><button class="button button-primary" data-action="open-library-form" data-type="food">新增食物</button></div><div class="library-list">${state.bootstrap.foods.map((food) => `<div class="library-item"><div><strong>${escapeHtml(food.name)}</strong><small>${escapeHtml(food.groupName || '未分组')} · ${escapeHtml(food.state)} · ${food.purineLow === null ? '暂无参考值' : `${formatRange(food.purineLow, food.purineHigh)} / 100g`} </small></div><div><span class="status-label ${food.verificationStatus === 'PREPARED' ? 'prepared' : ''}">${escapeHtml(food.verificationStatus)}</span><button class="text-button" data-action="open-library-form" data-type="food" data-id="${escapeHtml(food.id)}">编辑</button><button class="text-button" data-action="delete-library-item" data-kind="food" data-id="${escapeHtml(food.id)}">删除</button></div></div>`).join('')}</div></section><section class="panel">${renderKindGroupManager('food', '食物')}<div class="panel-divider"></div><div class="panel-header"><div><h4>来源状态</h4><p>只有逐项人工核对后才能标为 VERIFIED。</p></div><span class="mono">SOURCES</span></div>${state.bootstrap.sources.map((source) => `<div class="library-item"><div><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.publisher || '')} · ${escapeHtml(source.version || '')}</small></div><span class="status-label prepared">登记</span></div>`).join('')}<button class="button button-secondary button-block" data-action="open-source-form">登记新来源</button></section></div>`;
}

function renderRecipeLibrary() {
  return `<div class="manage-layout"><section class="panel"><div class="panel-header"><div><h4>菜谱版本</h4><p>按配料计算与手工范围分开；菜谱不能嵌套菜谱。</p></div><button class="button button-primary" data-action="open-library-form" data-type="recipe">新增菜谱</button></div><div class="library-list">${state.bootstrap.recipes.length ? state.bootstrap.recipes.map((recipe) => `<div class="library-item"><div><strong>${escapeHtml(recipe.name)}</strong><small>${escapeHtml(recipe.groupName || '未分组')} · ${recipe.mode === 'ingredients' ? '按配料计算' : '手工估计'} · ${recipe.purineLow === null ? '暂无每 100g 估算' : `${formatRange(recipe.purineLow, recipe.purineHigh)} / 100g`}</small></div><div><span class="status-label ${recipe.verificationStatus === 'PREPARED' ? 'prepared' : ''}">${escapeHtml(recipe.verificationStatus)}</span><button class="text-button" data-action="open-library-form" data-type="recipe" data-id="${escapeHtml(recipe.id)}">编辑</button><button class="text-button" data-action="delete-library-item" data-kind="recipe" data-id="${escapeHtml(recipe.id)}">删除</button></div></div>`).join('') : '<div class="empty-state"><strong>还没有菜谱</strong><span>可以先创建一个按配料计算的菜谱。</span></div>'}</div></section><section class="panel">${renderKindGroupManager('recipe', '菜谱')}</section></div>`;
}

function renderBeverageLibrary() {
  return `<div class="manage-layout"><section class="panel"><div class="panel-header"><div><h4>饮品目录</h4><p>系统预置只是方便开始，不代表医学推荐；含糖版本请单独建条目。</p></div><button class="button button-primary" data-action="open-library-form" data-type="beverage">新增饮品</button></div><div class="library-list">${state.bootstrap.beverages.map((beverage) => `<div class="library-item"><div><strong>${escapeHtml(beverage.name)}</strong><small>${escapeHtml(beverage.groupName || '未分组')} · ${beverage.isPlainWater ? '纯净水' : '其他饮品'}${beverage.containsSugar ? ' · 含糖' : ''}</small></div><div><span class="status-label">${beverage.system ? '系统预置' : '自建'}</span><button class="text-button" data-action="open-library-form" data-type="beverage" data-id="${escapeHtml(beverage.id)}">编辑</button>${beverage.system ? '' : `<button class="text-button" data-action="delete-library-item" data-kind="beverage" data-id="${escapeHtml(beverage.id)}">删除</button>`}</div></div>`).join('')}</div></section><section class="panel">${renderKindGroupManager('beverage', '饮品')}</section></div>`;
}

function renderKindGroupManager(kind, label) {
  const groups = state.bootstrap.groups[`${kind}s`] || [];
  return `<div class="kind-group-manager" data-group-manager="${escapeHtml(kind)}"><div class="panel-header"><div><h4>${escapeHtml(label)}分组</h4><p>只管理${escapeHtml(label)}；与其他标签页的分组彼此独立。</p></div><button class="button button-secondary" data-action="open-group-form" data-kind="${escapeHtml(kind)}">新建${escapeHtml(label)}分组</button></div><div class="library-list">${groups.map((group) => `<div class="library-item"><div><strong>${escapeHtml(group.name)}</strong><small>${group.system ? '系统预置分组' : `自建${escapeHtml(label)}分组`}</small></div><div>${group.system ? '<span class="status-label">系统预置</span>' : `<button class="text-button" data-action="open-group-form" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(group.id)}">编辑</button><button class="text-button" data-action="delete-group" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(group.id)}">删除</button>`}</div></div>`).join('')}</div><div class="group-unassigned"><strong>未分组</strong><span>新增或编辑${escapeHtml(label)}时选择“未分组”即可，不需要专门创建这个分组。</span></div></div>`;
}

function renderSettingsLibrary() {
  const settings = state.bootstrap.settings;
  const backupAlert = state.bootstrap.backupAlert;
  const portions = ['food', 'recipe', 'beverage'].map((kind) => `<div class="form-field"><label>${kind === 'food' ? '食物' : kind === 'recipe' ? '菜谱' : '饮品'}快捷模板（${kind === 'beverage' ? 'mL' : 'g'}）</label><div class="preset-row">${state.bootstrap.portions.filter((item) => item.kind === kind).map((item) => `<input class="portion-input" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(item.id)}" type="number" min="0.1" step="0.1" value="${escapeHtml(item.value)}" aria-label="${escapeHtml(kind)}模板" style="width:78px" />`).join('')}</div></div>`).join('');
  const sessions = state.sessions.length ? `<div class="library-list">${state.sessions.map((session) => `<div class="library-item"><div><strong>${session.device_label ? escapeHtml(session.device_label.slice(0, 42)) : '未命名设备'}</strong><small>创建 ${escapeHtml(session.created_at)} · 最后使用 ${escapeHtml(session.last_used_at)} · 到期 ${escapeHtml(session.expires_at)}</small></div><div><span class="status-label ${session.revoked_at ? '' : 'prepared'}">${session.revoked_at ? '已撤销' : '有效'}</span>${session.revoked_at ? '' : `<button class="text-button" data-action="revoke-session" data-id="${escapeHtml(session.id)}">撤销</button>`}</div></div>`).join('')}</div>` : '<div class="empty-state"><strong>没有可信设备</strong><span>当前浏览器验证后会出现在这里。</span></div>';
  return `<div class="manage-layout"><section class="panel"><div class="panel-header"><div><h4>显示与录入设置</h4><p>饮水目标只是个人配置，不自动判定达标或风险。</p></div></div><form data-form="settings" class="settings-stack"><div class="setting-row"><div><label for="setting-unit">血尿酸首选单位</label><small>只改变显示，不修改历史原始数据。</small></div><select id="setting-unit" name="defaultUrateUnit" style="max-width:130px"><option value="umol/L" ${settings.defaultUrateUnit === 'umol/L' ? 'selected' : ''}>μmol/L</option><option value="mg/dL" ${settings.defaultUrateUnit === 'mg/dL' ? 'selected' : ''}>mg/dL</option></select></div><div class="setting-row"><div><label for="setting-water">饮水目标（mL/日）</label><small>心肾功能或限液情况不确定时，先咨询专业人员。</small></div><input id="setting-water" name="waterGoalMl" type="number" min="1" value="${settings.waterGoalMl || ''}" placeholder="可留空" style="max-width:130px" /></div><button class="button button-primary" type="submit">保存设置</button></form><form data-form="portions" class="settings-stack" style="margin-top:18px"><div class="panel-header"><div><h4>快捷份量模板</h4><p>自定义值仍可在录入时直接输入。</p></div></div>${portions}<button class="button button-secondary" type="submit">保存模板</button></form></section><section class="panel"><div class="panel-header"><div><h4>备份与迁移</h4><p>完整导出不包含口令、设备凭证或服务器密钥。</p></div></div><div class="settings-stack"><button class="button button-secondary button-block" data-action="download-export" data-format="json">下载完整 JSON 导出</button><button class="button button-secondary button-block" data-action="download-export" data-format="zip">下载 ZIP 导出</button><button class="button button-secondary button-block" data-action="download-csv" data-format="urate">导出血尿酸 CSV</button><button class="button button-secondary button-block" data-action="download-csv" data-format="daily-summary">导出每日汇总 CSV</button><button class="button button-secondary button-block" data-action="create-snapshot">创建 SQLite 安全快照</button><label class="button button-secondary button-block" style="display:grid;place-items:center">预览恢复文件<input id="restore-file" type="file" accept="application/json,.json" hidden /></label><button class="button button-danger button-block" data-action="delete-all-data">删除全部个人记录</button><div id="backup-status" class="form-hint"></div></div></section></div><div class="manage-layout" style="margin-top:14px"><section class="panel"><div class="panel-header"><div><h4>访问口令</h4><p>修改后所有可信设备立即失效，服务重启仍保持新口令。</p></div></div><form data-form="password" class="settings-stack"><input name="newPassword" type="password" minlength="8" autocomplete="new-password" placeholder="新口令（至少 8 个字符）" required /><input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" placeholder="再次输入新口令" required /><button class="button button-danger" type="submit">修改共享访问口令</button></form></section><section class="panel"><div class="panel-header"><div><h4>可信设备</h4><p>撤销后旧 Cookie 下一次请求立即失效。</p></div><button class="text-button" data-action="revoke-all-sessions">撤销全部</button></div>${sessions}</section></div>${backupAlert ? `<div class="info-strip" style="margin-top:14px">最近一次备份或异机复制出现失败：${escapeHtml(backupAlert.status)}。请检查备份目录、权限和异机目标，直到后续成功备份清除告警。</div>` : ''}<div class="info-strip" style="margin-top:14px">自动备份只有在成功恢复验证后才能标记 VERIFIED。当前页面可以生成本地快照和可移植导出；异机复制与真实目标服务器迁移仍需按部署环境演练。</div>`;
}

function openModal(title, subtitle, content, context = {}) {
  state.modalContext = context;
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><div class="modal-header"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle || '')}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭">×</button></div>${content}</section></div>`;
  document.body.style.overflow = 'hidden';
}

function closeModal() { $('#modal-root').innerHTML = ''; document.body.style.overflow = ''; state.modalContext = null; }

function pickerOptions(kind, search = '') {
  const list = kind === 'recipe' ? state.bootstrap.recipes.filter((item) => item.purineLow !== null && item.purineHigh !== null) : state.bootstrap.foods;
  const value = search.trim().toLowerCase();
  return list.filter((item) => `${item.name} ${item.aliases || ''} ${item.groupName || ''}`.toLowerCase().includes(value)).slice(0, 40);
}

function renderPicker(kind, selectedId = '', search = '') {
  const options = pickerOptions(kind, search);
  return options.length ? options.map((item) => { const id = item.versionId; return `<button type="button" class="picker-option ${id === selectedId ? 'selected' : ''}" data-action="select-picker" data-version-id="${escapeHtml(id)}" data-item-name="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}<small>${escapeHtml(item.groupName || '未分组')} · ${item.purineLow === null ? '暂无估算' : formatRange(item.purineLow, item.purineHigh)} / 100g</small></span><span>${id === selectedId ? '✓' : '›'}</span></button>`; }).join('') : '<div class="empty-state" style="padding:15px">没有匹配的条目</div>';
}

function openDietModal(kind, edit = null) {
  const item = edit ? (kind === 'recipe' ? state.bootstrap.recipes.find((x) => x.versionId === edit.recipeVersionId || x.id === edit.recipeId) : state.bootstrap.foods.find((x) => x.versionId === edit.foodVersionId || x.id === edit.foodId)) : null;
  const selectedId = item?.versionId || '';
  const presets = state.bootstrap.portions.filter((preset) => preset.kind === kind);
  openModal(edit ? '修改饮食记录' : `记录${kind === 'recipe' ? '菜谱' : '食物'}`, '服务器确认后才会显示为已保存；历史记录保留录入时快照。', `<form data-form="diet" data-id="${escapeHtml(edit?.id || '')}" data-kind="${escapeHtml(kind)}"><div class="form-grid"><div class="form-field full"><label>记录日期</label><input name="date" type="date" value="${escapeHtml(edit?.date || state.currentDate)}" required /></div><div class="form-field full picker"><label>${kind === 'recipe' ? '搜索菜谱（名称、别名或分组）' : '搜索食物（名称、别名或分组）'}</label><input class="picker-search" type="search" placeholder="输入关键词" value="${escapeHtml(item?.name || edit?.name || '')}" autocomplete="off" /><input name="versionId" class="picker-value" type="hidden" value="${escapeHtml(selectedId)}" required /><div class="picker-results">${renderPicker(kind, selectedId, item?.name || edit?.name || '')}</div><p class="form-hint picker-selected">${item ? `已选择：${escapeHtml(item.name)}` : '请选择一个条目'}</p></div><div class="form-field full"><label>快捷份量</label><div class="preset-row">${presets.map((preset) => `<button type="button" class="preset-button" data-action="use-preset" data-value="${escapeHtml(preset.value)}">${preset.value}g</button>`).join('')}</div><input name="quantityG" type="number" step="0.1" min="0.1" value="${escapeHtml(edit?.quantityG || '')}" placeholder="也可以输入自定义克数" required /></div></div><div class="preview-card"><small>保存前预览</small><strong class="diet-preview">请选择条目和克数</strong><p>估算范围来自当前参考版本；保存后历史记录不会随参考库静默改写。</p></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">${edit ? '保存修改' : '保存记录'}</button></div></form>`, { type: 'diet', kind });
  updateDietPreview();
}

function updateDietPreview() {
  const form = $('[data-form="diet"]'); if (!form) return;
  const kind = form.dataset.kind; const id = $('.picker-value', form)?.value; const quantity = Number($('[name="quantityG"]', form)?.value); const list = kind === 'recipe' ? state.bootstrap.recipes : state.bootstrap.foods; const item = list.find((x) => x.versionId === id);
  $('.diet-preview', form).textContent = item && quantity > 0 && item.purineLow !== null && item.purineHigh !== null ? formatRange(quantity / (kind === 'recipe' ? 100 : item.basisG) * item.purineLow, quantity / (kind === 'recipe' ? 100 : item.basisG) * item.purineHigh) : item && quantity > 0 ? '暂无估算（不会按 0 计算）' : '请选择条目和克数';
}

function openBeverageModal(edit = null) {
  const beverage = state.bootstrap.beverages.find((x) => x.id === edit?.beverageId);
  const presets = state.bootstrap.portions.filter((preset) => preset.kind === 'beverage');
  openModal(edit ? '修改饮品记录' : '记录饮品', '饮品只统计容量，不自动赋予降尿酸值。', `<form data-form="beverage" data-id="${escapeHtml(edit?.id || '')}"><div class="form-grid"><div class="form-field full"><label>记录日期</label><input name="date" type="date" value="${escapeHtml(edit?.date || state.currentDate)}" required /></div><div class="form-field full"><label>饮品</label><select name="beverageId" required>${state.bootstrap.beverages.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === beverage?.id ? 'selected' : ''}>${escapeHtml(item.name)}${item.system ? ' · 系统预置' : ''}</option>`).join('')}</select></div><div class="form-field"><label>每份容量（mL）</label><input name="amountMl" type="number" min="0.1" step="0.1" value="${escapeHtml(edit?.quantity > 1 ? edit.amountMl / edit.quantity : edit?.amountMl || '')}" required /></div><div class="form-field"><label>数量</label><input name="quantity" type="number" min="1" step="1" value="${escapeHtml(edit?.quantity || 1)}" required /></div><div class="form-field full"><label>快捷容量</label><div class="preset-row">${presets.map((preset) => `<button type="button" class="preset-button" data-action="use-preset" data-value="${escapeHtml(preset.value)}">${escapeHtml(preset.value)}mL</button>`).join('')}</div></div></div><div class="preview-card"><small>规范化总量</small><strong class="beverage-preview">—</strong><p>例如 500mL × 2 会保存为 1000mL。</p></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">${edit ? '保存修改' : '保存饮品'}</button></div></form>`, { type: 'beverage' });
  updateBeveragePreview();
}

function updateBeveragePreview() { const form = $('[data-form="beverage"]'); if (!form) return; const amount = Number($('[name="amountMl"]', form).value); const quantity = Number($('[name="quantity"]', form).value); $('.beverage-preview', form).textContent = amount > 0 && quantity > 0 ? `${formatNumber(amount * quantity, 0)}mL` : '—'; }

function openMeasurementModal(edit = null) {
  openModal(edit ? '修改尿酸实测' : '记录尿酸实测', '保存原始输入与规范化值；换算只用于统一统计口径，不作医学解释。', `<form data-form="measurement" data-id="${escapeHtml(edit?.id || '')}"><div class="form-grid"><div class="form-field"><label>测量日期</label><input name="date" type="date" value="${escapeHtml(edit?.date || state.currentDate)}" required /></div><div class="form-field"><label>测量时间（可选）</label><input name="time" type="time" value="${escapeHtml(edit?.time || '')}" /></div><div class="form-field"><label>原始数值</label><input name="valueOriginal" type="number" min="0.01" step="0.01" value="${escapeHtml(edit?.valueOriginal || '')}" required /></div><div class="form-field"><label>原始单位</label><select name="unitOriginal"><option value="umol/L" ${edit?.unitOriginal !== 'mg/dL' ? 'selected' : ''}>μmol/L</option><option value="mg/dL" ${edit?.unitOriginal === 'mg/dL' ? 'selected' : ''}>mg/dL</option></select></div><div class="form-field"><label>空腹状态</label><select name="fasting"><option value="unknown" ${!edit || edit.fasting === 'unknown' ? 'selected' : ''}>未知</option><option value="fasting" ${edit?.fasting === 'fasting' ? 'selected' : ''}>空腹</option><option value="non_fasting" ${edit?.fasting === 'non_fasting' ? 'selected' : ''}>非空腹</option></select></div><div class="form-field"><label>来源</label><select name="sourceKind"><option value="" ${!edit?.sourceKind ? 'selected' : ''}>未填写</option><option value="医院检验">医院检验</option><option value="体检">体检</option><option value="家用设备">家用设备</option><option value="其他">其他</option></select></div><div class="form-field full"><label>检测机构或设备名称（可选）</label><input name="facility" value="${escapeHtml(edit?.facility || '')}" placeholder="例如：某医院检验科" /></div><div class="form-field"><label>报告参考下限（可选）</label><input name="referenceLowOriginal" type="number" min="0" step="0.01" value="${escapeHtml(edit?.referenceLowOriginal ?? '')}" /></div><div class="form-field"><label>报告参考上限（可选）</label><input name="referenceHighOriginal" type="number" min="0" step="0.01" value="${escapeHtml(edit?.referenceHighOriginal ?? '')}" /></div><div class="form-field full"><label>备注</label><textarea name="note" placeholder="不记录药物建议；只记可回看的事实。">${escapeHtml(edit?.note || '')}</textarea></div></div><div class="preview-card"><small>保存前换算预览</small><strong class="urate-preview">请输入数值</strong><p>固定换算：μmol/L = mg/dL × 59.48。</p></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">${edit ? '保存修改' : '保存实测'}</button></div></form>`, { type: 'measurement' });
  updateUratePreview();
}

function updateUratePreview() { const form = $('[data-form="measurement"]'); if (!form) return; const value = Number($('[name="valueOriginal"]', form).value); const unit = $('[name="unitOriginal"]', form).value; $('.urate-preview', form).textContent = value > 0 ? `${formatNumber(value, 2)} ${unit} = ${formatNumber(unit === 'mg/dL' ? value * 59.48 : value, 2)} μmol/L` : '请输入数值'; }

function openLibraryForm(type, editId = null) {
  if (type === 'food') {
    const food = state.bootstrap.foods.find((x) => x.id === editId); const groups = state.bootstrap.groups.foods;
    openModal(editId ? '编辑食物 / 新建版本' : '新增食物', '未知值请留空；不会用 0 代替未知。', `<form data-form="library-food" data-id="${escapeHtml(editId || '')}"><div class="form-grid"><div class="form-field full"><label>名称</label><input name="name" value="${escapeHtml(food?.name || '')}" required /></div><div class="form-field"><label>别名（逗号分隔）</label><input name="aliases" value="${escapeHtml(food?.aliases || '')}" /></div><div class="form-field"><label>状态 / 口径</label><input name="state" value="${escapeHtml(food?.state || '可食部')}" required /></div><div class="form-field"><label>分组</label><select name="groupId"><option value="">未分组</option>${groups.map((group) => `<option value="${escapeHtml(group.id)}" ${food?.groupId === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}</select></div><div class="form-field"><label>计量基准（g）</label><input name="basisG" type="number" min="0.1" step="0.1" value="${escapeHtml(food?.basisG || 100)}" required /></div><div class="form-field"><label>嘌呤下限（mg/100g）</label><input name="purineLow" type="number" min="0" step="0.01" value="${escapeHtml(food?.purineLow ?? '')}" /></div><div class="form-field"><label>嘌呤均值（可选）</label><input name="purineMean" type="number" min="0" step="0.01" value="${escapeHtml(food?.purineMean ?? '')}" /></div><div class="form-field"><label>嘌呤上限（mg/100g）</label><input name="purineHigh" type="number" min="0" step="0.01" value="${escapeHtml(food?.purineHigh ?? '')}" /></div><div class="form-field"><label>复核状态</label><select name="verificationStatus"><option value="PREPARED" ${food?.verificationStatus !== 'VERIFIED' ? 'selected' : ''}>PREPARED / 待复核</option><option value="VERIFIED" ${food?.verificationStatus === 'VERIFIED' ? 'selected' : ''}>VERIFIED / 已核对</option></select></div><div class="form-field full"><label>备注</label><textarea name="notes">${escapeHtml(food?.notes || '')}</textarea></div></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">保存${editId ? '新版本' : '食物'}</button></div></form>`, { type: 'library-food' });
  }
  if (type === 'beverage') {
    const beverage = state.bootstrap.beverages.find((x) => x.id === editId); const groups = state.bootstrap.groups.beverages;
    openModal(editId ? '编辑饮品' : '新增饮品', '同名但含糖、含奶或含酒精的版本请单独建条目。', `<form data-form="library-beverage" data-id="${escapeHtml(editId || '')}"><div class="form-grid"><div class="form-field full"><label>名称</label><input name="name" value="${escapeHtml(beverage?.name || '')}" required /></div><div class="form-field"><label>别名</label><input name="aliases" value="${escapeHtml(beverage?.aliases || '')}" /></div><div class="form-field"><label>分组</label><select name="groupId"><option value="">未分组</option>${groups.map((group) => `<option value="${escapeHtml(group.id)}" ${beverage?.groupId === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}</select></div><div class="form-field"><label>备注</label><input name="notes" value="${escapeHtml(beverage?.notes || '')}" /></div><label class="setting-row"><span>纯净水</span><input name="isPlainWater" type="checkbox" ${beverage?.isPlainWater ? 'checked' : ''} style="width:20px;min-height:20px" /></label><label class="setting-row"><span>含糖</span><input name="containsSugar" type="checkbox" ${beverage?.containsSugar ? 'checked' : ''} style="width:20px;min-height:20px" /></label></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">保存饮品</button></div></form>`, { type: 'library-beverage' });
  }
  if (type === 'recipe') openRecipeModal(editId);
}

function openRecipeModal(editId = null) {
  const recipe = state.bootstrap.recipes.find((x) => x.id === editId); const groups = state.bootstrap.groups.recipes;
  openModal(editId ? '编辑菜谱 / 新建版本' : '新增菜谱', '菜谱可以按配料计算，也可以保存手工范围；两者会明确标识。', `<form data-form="library-recipe" data-id="${escapeHtml(editId || '')}"><div class="form-grid"><div class="form-field full"><label>名称</label><input name="name" value="${escapeHtml(recipe?.name || '')}" required /></div><div class="form-field"><label>分组</label><select name="groupId"><option value="">未分组</option>${groups.map((group) => `<option value="${escapeHtml(group.id)}" ${recipe?.groupId === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}</select></div><div class="form-field"><label>计算方式</label><select name="mode"><option value="ingredients" ${recipe?.mode !== 'manual' ? 'selected' : ''}>按配料计算</option><option value="manual" ${recipe?.mode === 'manual' ? 'selected' : ''}>手工范围</option></select></div><div class="form-field"><label>成品重量（g，可选）</label><input name="finalYieldG" type="number" min="0.1" step="0.1" value="${escapeHtml(recipe?.finalYieldG || '')}" placeholder="配料计算建议填写" /></div><div class="form-field"><label>每 100g 下限（手工）</label><input name="purineLow" type="number" min="0" step="0.01" value="${escapeHtml(recipe?.mode === 'manual' ? recipe.purineLow ?? '' : '')}" /></div><div class="form-field"><label>每 100g 上限（手工）</label><input name="purineHigh" type="number" min="0" step="0.01" value="${escapeHtml(recipe?.mode === 'manual' ? recipe.purineHigh ?? '' : '')}" /></div><div class="form-field full"><label>配料（按配料计算时填写）</label><div id="ingredient-rows"></div><button type="button" class="button button-secondary" data-action="add-ingredient">＋ 添加配料</button></div><div class="form-field full"><label>备注 / 来源说明</label><textarea name="notes">${escapeHtml(recipe?.notes || '')}</textarea></div></div><p class="form-hint">没有成品重量时只能保存整份原料估算，不会声称得到可靠的每 100g 成品值。</p><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">保存${editId ? '新版本' : '菜谱'}</button></div></form>`, { type: 'library-recipe' });
  const existingIngredients = recipe?.ingredients || [];
  if (existingIngredients.length) existingIngredients.forEach((ingredient) => addIngredientRow(ingredient));
  else addIngredientRow();
  $('[name="mode"]').addEventListener('change', toggleRecipeMode);
  toggleRecipeMode();
}

function addIngredientRow(item = null) {
  const root = $('#ingredient-rows'); if (!root) return;
  const row = document.createElement('div'); row.className = 'ingredient-row'; row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) 100px 40px;gap:7px;margin-bottom:7px;';
  row.innerHTML = `<select name="foodVersionId" required><option value="">选择食物版本</option>${state.bootstrap.foods.map((food) => `<option value="${escapeHtml(food.versionId)}" ${food.versionId === item?.foodVersionId ? 'selected' : ''}>${escapeHtml(food.name)} · ${food.purineLow === null ? '未知' : formatRange(food.purineLow, food.purineHigh)}</option>`).join('')}</select><input name="grams" type="number" min="0.1" step="0.1" value="${escapeHtml(item?.grams || '')}" placeholder="克数" required /><button class="icon-button" type="button" data-action="remove-ingredient" aria-label="移除配料">×</button>`;
  root.appendChild(row);
}

function toggleRecipeMode() { const form = $('[data-form="library-recipe"]'); if (!form) return; const manual = $('[name="mode"]', form).value === 'manual'; $$('.ingredient-row select, .ingredient-row input', form).forEach((input) => { input.disabled = manual; input.required = !manual; }); $('[name="purineLow"]', form).required = manual; $('[name="purineHigh"]', form).required = manual; }

function openGroupModal(kind = 'food', edit = null) {
  const label = kind === 'recipe' ? '菜谱' : kind === 'beverage' ? '饮品' : '食物';
  openModal(edit ? `编辑${label}分组` : `新增${label}分组`, '分组只用于查找和筛选；内容也可以保留在未分组。', `<form data-form="group" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(edit?.id || '')}"><div class="form-field"><label>归属标签页</label><input value="${escapeHtml(label)}" disabled /></div><div class="form-field" style="margin-top:12px"><label>名称</label><input name="name" value="${escapeHtml(edit?.name || '')}" required /></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">保存分组</button></div></form>`, { type: 'group' });
}

function openSourceModal() {
  openModal('登记参考来源', '登记不等于逐项核验；来源和使用限制要一起保留。', `<form data-form="source"><div class="form-grid"><div class="form-field full"><label>标题</label><input name="title" required /></div><div class="form-field"><label>发布方</label><input name="publisher" /></div><div class="form-field"><label>版本 / 年份</label><input name="version" /></div><div class="form-field full"><label>URL</label><input name="url" type="url" /></div><div class="form-field full"><label>使用说明</label><textarea name="usageNote" placeholder="页码、表号、单位映射或核验限制"></textarea></div></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">保存来源</button></div></form>`);
}

function showGate(message = '') {
  $('#gate').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#login-message').textContent = message; state.csrf = null;
}

async function boot() {
  try {
    const status = await api('/api/auth/status');
    state.status = status;
    if (!status.authenticated) return showGate(status.configured ? '' : '服务器尚未配置共享访问口令，请先在服务器运行 npm run setup:password。');
    state.csrf = status.csrfToken;
    $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden');
    await loadData(); setRoute(state.route);
  } catch (error) { showGate(error.message); }
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'close-modal') { if (event.target.classList.contains('modal-backdrop') || button.classList.contains('modal-close') || button.classList.contains('button-secondary')) closeModal(); return; }
    if (action === 'shift-date') { state.currentDate = addDays(state.currentDate, Number(button.dataset.days)); await renderCurrentRoute(); return; }
    if (action === 'open-diet') { openDietModal(button.dataset.kind); return; }
    if (action === 'open-beverage') { openBeverageModal(); return; }
    if (action === 'open-measurement') { openMeasurementModal(); return; }
    if (action === 'use-preset') { const form = button.closest('form'); const input = form.querySelector('[name="quantityG"], [name="amountMl"]'); input.value = button.dataset.value; input.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (action === 'select-picker') { const form = button.closest('form'); $('[name="versionId"]', form).value = button.dataset.versionId; $('.picker-search', form).value = button.dataset.itemName; $('.picker-selected', form).textContent = `已选择：${button.dataset.itemName}`; $$('.picker-option', form).forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); updateDietPreview(); return; }
    if (action === 'edit-diet') { const item = state.day.dietEntries.find((x) => x.id === button.dataset.id); openDietModal(button.dataset.kind, item); return; }
    if (action === 'delete-diet' && confirm('删除这条饮食记录？历史快照会保留在备份中。')) { await api(`/api/diet-entries/${button.dataset.id}`, { method: 'DELETE' }); showToast('饮食记录已删除'); await loadData(); await renderCurrentRoute(); return; }
    if (action === 'edit-beverage') { openBeverageModal(state.day.beverageEntries.find((x) => x.id === button.dataset.id)); return; }
    if (action === 'delete-beverage' && confirm('删除这条饮品记录？')) { await api(`/api/beverage-entries/${button.dataset.id}`, { method: 'DELETE' }); showToast('饮品记录已删除'); await loadData(); await renderCurrentRoute(); return; }
    if (action === 'edit-measurement') { openMeasurementModal(state.day.measurements.find((x) => x.id === button.dataset.id)); return; }
    if (action === 'delete-measurement' && confirm('删除这条血尿酸实测？')) { await api(`/api/measurements/${button.dataset.id}`, { method: 'DELETE' }); showToast('实测记录已删除'); await loadData(); await renderCurrentRoute(); return; }
    if (action === 'stats-period') { state.statsPeriod = button.dataset.period; await renderCurrentRoute(); return; }
    if (action === 'open-history-day') { state.currentDate = button.dataset.date; setRoute('today'); return; }
    if (action === 'manage-tab') { state.manageTab = button.dataset.tab; renderCurrentRoute(); return; }
    if (action === 'open-library-form') { openLibraryForm(button.dataset.type, button.dataset.id); return; }
    if (action === 'delete-library-item' && confirm('从当前参考库移除这条资料？系统会归档它，历史记录中的录入快照不会改变。')) {
      const kind = button.dataset.kind;
      const resource = kind === 'recipe' ? 'recipes' : kind === 'beverage' ? 'beverages' : 'foods';
      const label = kind === 'recipe' ? '菜谱' : kind === 'beverage' ? '饮品' : '食物';
      await api(`/api/${resource}/${button.dataset.id}`, { method: 'DELETE' });
      showToast(`${label}已从参考库移除`);
      await loadData(); renderCurrentRoute(); return;
    }
    if (action === 'add-ingredient') { addIngredientRow(); return; }
    if (action === 'remove-ingredient') { button.closest('.ingredient-row')?.remove(); return; }
    if (action === 'open-group-form') { const kind = button.dataset.kind || 'food'; const groups = state.bootstrap.groups[`${kind}s`] || []; openGroupModal(kind, groups.find((x) => x.id === button.dataset.id)); return; }
    if (action === 'delete-group' && confirm('删除分组？内容会移动到未分组。')) { await api(`/api/groups/${button.dataset.kind}/${button.dataset.id}`, { method: 'DELETE' }); showToast('分组已删除'); await loadData(); renderCurrentRoute(); return; }
    if (action === 'revoke-session' && confirm('撤销这个可信设备？它下一次请求就必须重新输入口令。')) { await api(`/api/auth/sessions/revoke/${button.dataset.id}`, { method: 'POST', body: JSON.stringify({}) }); showToast('设备已撤销'); await loadData(); renderCurrentRoute(); return; }
    if (action === 'revoke-all-sessions' && confirm('撤销全部可信设备？当前浏览器也会退出。')) { await api('/api/auth/sessions/revoke-all', { method: 'POST', body: JSON.stringify({}) }); showGate('所有设备已撤销，请重新输入共享访问口令'); return; }
    if (action === 'open-source-form') { openSourceModal(); return; }
    if (action === 'download-export') { window.location.href = `/api/backup/export.${button.dataset.format}`; return; }
    if (action === 'download-csv') { window.location.href = `/api/exports/${button.dataset.format}.csv`; return; }
    if (action === 'create-snapshot') { $('#backup-status').textContent = '正在创建在线快照…'; const result = await api('/api/backup/snapshot', { method: 'POST', body: JSON.stringify({}) }); $('#backup-status').textContent = `快照已创建：${result.sha256.slice(0, 16)}…；恢复验证后才能标记 VERIFIED。`; showToast('SQLite 安全快照已创建'); return; }
    if (action === 'delete-all-data' && confirm('这会删除全部饮食、饮品和血尿酸记录，并先尝试创建备份。继续？')) { const confirmation = prompt('请输入 DELETE_ALL_URIC_ACID 以确认：'); if (confirmation === 'DELETE_ALL_URIC_ACID') { await api('/api/data/delete-all', { method: 'POST', body: JSON.stringify({ confirmation, createBackup: true }) }); showToast('个人记录已删除'); await loadData(); await renderCurrentRoute(); } return; }
  } catch (error) { showToast(error.message, 'error'); }
});

document.addEventListener('input', (event) => {
  if (event.target.matches('.picker-search')) { const form = event.target.closest('form'); const kind = form.dataset.kind; $('.picker-results', form).innerHTML = renderPicker(kind, $('.picker-value', form).value, event.target.value); }
  if (event.target.closest('[data-form="diet"]')) updateDietPreview();
  if (event.target.closest('[data-form="beverage"]')) updateBeveragePreview();
  if (event.target.closest('[data-form="measurement"]')) updateUratePreview();
});

document.addEventListener('change', async (event) => {
  if (event.target.id === 'day-date') { state.currentDate = event.target.value; await renderCurrentRoute(); }
  if (event.target.id === 'history-date') { state.currentDate = event.target.value; await renderCurrentRoute(); }
  if (event.target.matches('[name="mode"]')) toggleRecipeMode();
  if (event.target.id === 'restore-file') {
    const file = event.target.files?.[0]; if (!file) return;
    try { const payload = JSON.parse(await file.text()); const preview = await api('/api/backup/restore/preview', { method: 'POST', body: JSON.stringify(payload) }); if (confirm(`将恢复 ${preview.dateRange ? `${preview.dateRange.from} 至 ${preview.dateRange.to}` : '无日期'} 的数据。确认继续？`)) { payload.confirmation = 'RESTORE_URIC_ACID'; await api('/api/backup/restore', { method: 'POST', body: JSON.stringify(payload) }); showGate('恢复完成。为安全起见，请重新输入共享访问口令。'); } } catch (error) { showToast(error.message, 'error'); }
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target; if (!form.matches('form[data-form]')) return; event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.form === 'diet') {
      const body = { clientId: form.dataset.id ? undefined : crypto.randomUUID(), date: data.date, kind: form.dataset.kind, versionId: data.versionId, quantityG: Number(data.quantityG) };
      const url = form.dataset.id ? `/api/diet-entries/${form.dataset.id}` : '/api/diet-entries'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast(form.dataset.id ? '饮食记录已更新' : '饮食记录已保存'); await loadData(); await renderCurrentRoute(); return;
    }
    if (form.dataset.form === 'beverage') { const body = { clientId: form.dataset.id ? undefined : crypto.randomUUID(), date: data.date, beverageId: data.beverageId, amountMl: Number(data.amountMl), quantity: Number(data.quantity) }; const url = form.dataset.id ? `/api/beverage-entries/${form.dataset.id}` : '/api/beverage-entries'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast(form.dataset.id ? '饮品记录已更新' : '饮品记录已保存'); await loadData(); await renderCurrentRoute(); return; }
    if (form.dataset.form === 'measurement') { const body = { clientId: form.dataset.id ? undefined : crypto.randomUUID(), date: data.date, time: data.time || null, valueOriginal: Number(data.valueOriginal), unitOriginal: data.unitOriginal, fasting: data.fasting, sourceKind: data.sourceKind, facility: data.facility, referenceLowOriginal: data.referenceLowOriginal, referenceHighOriginal: data.referenceHighOriginal, note: data.note }; const url = form.dataset.id ? `/api/measurements/${form.dataset.id}` : '/api/measurements'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast(form.dataset.id ? '实测已更新' : '实测已保存'); await loadData(); await renderCurrentRoute(); return; }
    if (form.dataset.form === 'library-food') { const body = { ...data, basisG: Number(data.basisG), purineLow: data.purineLow === '' ? null : Number(data.purineLow), purineMean: data.purineMean === '' ? null : Number(data.purineMean), purineHigh: data.purineHigh === '' ? null : Number(data.purineHigh) }; const url = form.dataset.id ? `/api/foods/${form.dataset.id}` : '/api/foods'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast('食物资料已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'library-beverage') { const body = { ...data, isPlainWater: form.querySelector('[name="isPlainWater"]').checked, containsSugar: form.querySelector('[name="containsSugar"]').checked }; const url = form.dataset.id ? `/api/beverages/${form.dataset.id}` : '/api/beverages'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast('饮品资料已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'library-recipe') { const ingredients = $$('.ingredient-row', form).map((row) => ({ foodVersionId: $('[name="foodVersionId"]', row).value, grams: Number($('[name="grams"]', row).value) })).filter((row) => row.foodVersionId); const body = { name: data.name, groupId: data.groupId, mode: data.mode, finalYieldG: data.finalYieldG ? Number(data.finalYieldG) : null, purineLow: data.purineLow ? Number(data.purineLow) : null, purineHigh: data.purineHigh ? Number(data.purineHigh) : null, notes: data.notes, ingredients }; const url = form.dataset.id ? `/api/recipes/${form.dataset.id}` : '/api/recipes'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast('菜谱资料已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'group') { const kind = form.dataset.kind; const body = { name: data.name }; const url = form.dataset.id ? `/api/groups/${kind}/${form.dataset.id}` : `/api/groups/${data.kind || kind}`; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast('分组已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'source') { await api('/api/sources', { method: 'POST', body: JSON.stringify(data) }); closeModal(); showToast('来源已登记'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'settings') { await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultUrateUnit: data.defaultUrateUnit, waterGoalMl: data.waterGoalMl }) }); showToast('设置已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'portions') { const portions = $$('.portion-input', form).map((input) => ({ kind: input.dataset.kind, value: Number(input.value) })); await api('/api/portions', { method: 'PUT', body: JSON.stringify({ portions }) }); showToast('快捷份量模板已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'password') { if (data.newPassword !== data.confirmPassword) throw new Error('两次新口令不一致'); await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ newPassword: data.newPassword }) }); showGate('共享访问口令已修改，所有设备需要重新验证'); return; }
  } catch (error) { showToast(error.message, 'error'); }
});

$$('[data-route]').forEach((button) => button.addEventListener('click', () => setRoute(button.dataset.route)));
window.addEventListener('hashchange', () => { const route = location.hash.replace('#', '') || 'today'; if (route !== state.route) setRoute(route); });
$('#refresh-button').addEventListener('click', async () => { await loadData(); await renderCurrentRoute(); showToast('已刷新'); });
$('#mobile-menu').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch {} showGate('已退出当前设备'); });
$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); const input = $('#login-password'); const message = $('#login-message'); message.textContent = '验证中…'; try { const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: input.value }) }); state.csrf = result.csrfToken; input.value = ''; $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden'); await loadData(); setRoute('today'); } catch (error) { message.textContent = error.message; input.select(); } });

function addDays(date, days) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + Number(days)); return value.toISOString().slice(0, 10); }

boot();

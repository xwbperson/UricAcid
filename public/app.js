const ROUTES = new Set(['today', 'treatment', 'history', 'stats', 'manage']);
let appTimeZone = 'Asia/Shanghai';
let modalTrigger = null;
let mobileMenuTrigger = null;
let generatedFieldId = 0;

function routeFromHash() {
  const route = location.hash.replace('#', '');
  return ROUTES.has(route) ? route : 'today';
}

const state = {
  csrf: null,
  status: null,
  bootstrap: null,
  day: null,
  stats: null,
  history: null,
  treatment: null,
  sessions: [],
  currentDate: todayIso(),
  route: routeFromHash(),
  dateInitialized: false,
  statsPeriod: '30',
  manageTab: 'food',
  manageGroupFilters: { food: '', recipe: '', beverage: '' },
  treatmentFilters: { from: '', to: '', type: '', q: '' },
  modalContext: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function syncMobileViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const bottomInset = Math.max(0, window.innerHeight - (viewport.offsetTop + viewport.height));
  document.documentElement.style.setProperty('--visual-viewport-bottom-inset', `${bottomInset}px`);
}

syncMobileViewport();
window.addEventListener('resize', syncMobileViewport, { passive: true });
window.visualViewport?.addEventListener('resize', syncMobileViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncMobileViewport, { passive: true });

function setMobileMenuOpen(open) {
  const sidebar = $('.sidebar');
  const backdrop = $('#mobile-menu-backdrop');
  const menuButton = $('#mobile-menu');
  if (!sidebar) return;
  sidebar.classList.toggle('open', open);
  backdrop?.classList.toggle('open', open);
  backdrop?.setAttribute('aria-hidden', String(!open));
  menuButton?.setAttribute('aria-expanded', String(open));
  menuButton?.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
  document.body.classList.toggle('mobile-menu-open', open);
  $('#main-content').inert = open;
  $('.bottom-nav').inert = open;
  if (open) {
    mobileMenuTrigger = document.activeElement;
    requestAnimationFrame(() => $('.sidebar .nav-item')?.focus());
  } else if (mobileMenuTrigger && document.contains(mobileMenuTrigger)) {
    mobileMenuTrigger.focus({ preventScroll: true });
    mobileMenuTrigger = null;
  }
}

function closeMobileMenu() { setMobileMenuOpen(false); }
function toggleMobileMenu() { setMobileMenuOpen(!$('.sidebar')?.classList.contains('open')); }

function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: appTimeZone }).format(new Date());
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

function preferredUrateUnit() {
  return state.bootstrap?.settings?.defaultUrateUnit === 'mg/dL' ? 'mg/dL' : 'μmol/L';
}

function urateValueInPreferredUnit(valueUmolL) {
  return preferredUrateUnit() === 'mg/dL' ? Number(valueUmolL) / 59.48 : Number(valueUmolL);
}

function formatUrateDelta(valueUmolL) {
  const value = urateValueInPreferredUnit(valueUmolL);
  return `${value >= 0 ? '+' : ''}${formatNumber(value, 2)} ${preferredUrateUnit()}`;
}

function formatUrateMinMax(minUmolL, maxUmolL) {
  return `${formatNumber(urateValueInPreferredUnit(minUmolL), 2)} / ${formatNumber(urateValueInPreferredUnit(maxUmolL), 2)} ${preferredUrateUnit()}`;
}

const treatmentTypes = [
  ['flare', '痛风发作'],
  ['hospital_check', '医院检查'],
  ['oral_medication', '口服药'],
  ['topical_medication', '外用药'],
  ['symptom_change', '症状变化'],
  ['follow_up', '复诊计划'],
  ['other', '其他'],
];
const treatmentTypeLabel = Object.fromEntries(treatmentTypes);

function showToast(message, kind = 'info') {
  const region = $('#toast-region');
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
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
  const bootstrap = await api('/api/bootstrap');
  appTimeZone = bootstrap.settings?.timezone || 'Asia/Shanghai';
  if (!state.dateInitialized) {
    state.currentDate = todayIso();
    state.dateInitialized = true;
  }
  const [day, sessions] = await Promise.all([
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
  } else if (state.route === 'treatment') {
    const filters = state.treatmentFilters;
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.type) params.set('type', filters.type);
    if (filters.q) params.set('q', filters.q);
    state.treatment = (await api(`/api/treatment-events?${params.toString()}`)).events;
  } else if (state.route === 'stats') {
    let from = addDays(state.currentDate, -29);
    if (state.statsPeriod === '90') from = addDays(state.currentDate, -89);
    if (state.statsPeriod === '365') from = addDays(state.currentDate, -364);
    if (state.statsPeriod === 'all') from = '2000-01-01';
    state.stats = await api(`/api/statistics?from=${from}&to=${state.currentDate}`);
  }
}

function setRoute(route) {
  if (!ROUTES.has(route)) route = 'today';
  state.route = route;
  if (location.hash !== `#${route}`) location.hash = route;
  $$('.nav-item, .bottom-nav-item').forEach((item) => {
    const active = item.dataset.route === route;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
  });
  const meta = {
    today: ['TODAY / DAILY LOG', '今日'],
    treatment: ['CARE JOURNAL / TIMELINE', '治疗记录'],
    history: ['HISTORY / DAY BY DAY', '历史'],
    stats: ['STATISTICS / OBSERVATION', '统计'],
    manage: ['MANAGE / YOUR SOURCES', '管理'],
  }[route] || ['TODAY / DAILY LOG', '今日'];
  $('#page-kicker').textContent = meta[0]; $('#page-title').textContent = meta[1];
  closeMobileMenu();
  $('#main-content')?.focus({ preventScroll: true });
  renderCurrentRoute();
}

async function renderCurrentRoute() {
  if (!state.bootstrap) return;
  const view = $('#view');
  view.setAttribute('aria-busy', 'true');
  try {
    await loadRouteData();
    if (state.route === 'today') view.innerHTML = renderToday();
    if (state.route === 'treatment') view.innerHTML = renderTreatment();
    if (state.route === 'history') view.innerHTML = renderHistory();
    if (state.route === 'stats') view.innerHTML = renderStats();
    if (state.route === 'manage') view.innerHTML = renderManage();
  } catch (error) {
    showToast(error.message, 'error');
    view.innerHTML = `<div class="error-state" role="alert"><strong>当前页面加载失败</strong><span>${escapeHtml(error.message)}。请检查连接后重试。</span><button class="button button-primary" data-action="retry-route">重新加载</button></div>`;
  } finally {
    view.removeAttribute('aria-busy');
  }
}

function coverageBadge(summary) {
  if (!summary || summary.totalCount === 0) return '<span class="coverage-badge empty">尚无食物记录</span>';
  return summary.coverage === 'partial'
    ? `<span class="coverage-badge partial">部分覆盖 · ${summary.unknownCount} 项暂无参考</span>`
    : '<span class="coverage-badge">已覆盖记录</span>';
}

function guidanceStatusLabel(status, kind) {
  if (status === 'met') return '已达到参考量';
  if (status === 'near') return '接近参考量';
  if (status === 'in_progress') return kind === 'water' ? '持续记录中' : '继续搭配';
  return '尚无记录';
}

function renderGuidance(day) {
  const guidance = day.guidance;
  if (!guidance) return '';
  const latest = guidance.latestMeasurement;
  const vegetable = guidance.dietary.vegetable;
  const water = guidance.dietary.water;
  const urateReview = latest && latest.valueUmolL >= guidance.urate.maleUpperUmolL;
  const latestAdviceValue = latest ? formatUrate(latest.valueUmolL) : '单次实测';
  const urateCopy = latest
    ? urateReview
      ? `最近一次实测为 ${formatUrate(latest.valueUmolL)}，高于 WS/T 560—2017 中男性 ${guidance.urate.maleUpperUmolL}、女性 ${guidance.urate.femaleUpperUmolL} μmol/L 的定义参考线；该标准要求非同日两次空腹测量，不能用一次结果自行下诊断。已确诊痛风且正在接受降尿酸治疗时，ACR 的常见治疗目标参考为 <约 ${guidance.urate.goutTreatmentTargetUmolL} μmol/L，仍需由医生结合病情确认。`
      : `最近一次实测为 ${formatUrate(latest.valueUmolL)}；仍应结合检验报告、性别、是否有痛风和肾功能等信息，由专业人员判断。若已确诊痛风并正在治疗，目标由医生设定，不能把单次结果当作个人处方。`
    : '还没有血尿酸实测。录入检验报告后，这里会把最近一次实测与需要复核的参考线一起展示。';
  const alerts = guidance.alerts || [];
  const summaryStatus = alerts.length
    ? `${alerts.length} 条需要留意的记录提示`
    : latest ? `最近实测 ${formatUrate(latest.valueUmolL)}` : '尚无实测，记录后再查看';
  return `<details class="guidance-panel" data-guidance-panel ${alerts.length ? 'open' : ''}><summary class="guidance-summary"><span><strong>记录参考与医学边界</strong><small>${escapeHtml(summaryStatus)}</small></span><span class="details-toggle" aria-hidden="true">展开</span></summary><div class="guidance-content"><div class="panel-header"><div><h4>基于最近实测的参考建议</h4><p>按来源资料给出记录提示，不把一次实测或食物估算变成诊断、处方或个人治疗目标。</p></div><span class="mono">GUIDANCE / ${latest ? escapeHtml(formatUrate(latest.valueUmolL)) : 'NO TEST'}</span></div><div class="guidance-grid"><article class="guidance-card guidance-urate"><small>最近一次血尿酸</small><strong>${latest ? escapeHtml(formatUrate(latest.valueUmolL)) : '—'}</strong><span>${latest ? `${formatDate(latest.date, false)} · ${urateReview ? '需要复核' : '已记录'}` : '建议先录入真实报告'}</span><p>${escapeHtml(urateCopy)}</p></article><article class="guidance-card"><small>新鲜蔬菜一般参考</small><strong>≥ ${vegetable.referenceG}g / 日</strong><span>${guidanceStatusLabel(vegetable.status, 'vegetable')} · 直接记录 ${formatNumber(vegetable.loggedG, 0)}g</span><p>指南建议每天保证蔬菜摄入；这里只统计系统“蔬菜”分组的直接食物记录，菜谱不会被假装拆分。</p></article><article class="guidance-card"><small>饮品容量一般参考</small><strong>≥ ${water.referenceMl}mL / 日</strong><span>${guidanceStatusLabel(water.status, 'water')} · 已记录 ${formatNumber(water.loggedMl, 0)}mL</span><p>${water.isCustom ? '这是你在设置中填写的个人记录目标。' : '一般资料建议至少 2000mL；2024 食养指南的 2000–3000mL 仅适用于心、肾功能正常且没有限液要求的情况。'}</p></article></div>${alerts.length ? `<div class="guidance-alerts">${alerts.map((alert) => `<div class="guidance-alert ${escapeHtml(alert.level)}"><strong>${alert.level === 'review' ? '复核提醒' : '接近提醒'}</strong><span>${escapeHtml(alert.message)}</span></div>`).join('')}</div>` : '<div class="guidance-ok">添加记录后，这里会在接近蔬菜或饮水参考量时提示；空白日期不会被当成 0。</div>'}<div class="guidance-footnote">若已经确诊痛风或正在接受降尿酸治疗，血尿酸目标应由医生结合病情确定；不要仅凭 ${escapeHtml(latestAdviceValue)} 自行停药、加药或限水。饮食记录页只提供来源性一般食养参考。</div></div></details>`;
}

function actionIcon(kind) {
  const paths = {
    food: '<path d="M12 5v14M5 12h14" />',
    recipe: '<path d="M5 6h14M5 12h14M5 18h9" />',
    beverage: '<path d="M5 6h14l-1.4 12H7.4L5 6Zm3 4h6" />',
    measurement: '<path d="m4 17 5-5 3 3 7-8" /><path d="M15 7h4v4" />',
    treatment: '<path d="M12 4v16M4 12h16" /><circle cx="12" cy="12" r="9" />',
  };
  return `<span class="action-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${paths[kind]}</svg></span>`;
}

function treatmentEventTime(event) {
  return event.eventTime || '时间未填写';
}

function treatmentEventDetail(event) {
  const details = [];
  if (event.eventType === 'flare' && event.symptomSite) details.push(`部位：${event.symptomSite}`);
  if (event.eventType === 'symptom_change' && event.symptomState) details.push(event.symptomState);
  if (event.medicineName) details.push(event.medicineName);
  if (event.dosage) details.push(`${event.dosage}${event.dosageUnit || ''}`);
  if (event.frequency) details.push(event.frequency);
  if (event.applicationSite) details.push(`部位：${event.applicationSite}`);
  if (event.eventType === 'hospital_check' && event.testName) details.push(event.testName);
  if (event.facility) details.push(event.facility);
  if (event.reportConclusion) details.push(`结论：${event.reportConclusion}`);
  if (event.eventType === 'follow_up' && event.planItem) details.push(event.planItem);
  if (event.followUpDate) details.push(`复诊：${event.followUpDate}`);
  if (event.severity !== null && event.severity !== undefined) details.push(`程度 ${formatNumber(event.severity, 1)}/10`);
  if (event.results?.length) details.push(`${event.results.length} 项检查结果`);
  if (event.symptomDescription) details.push(event.symptomDescription);
  if (event.instructions) details.push(event.instructions);
  if (event.eventType === 'other' && event.otherDescription) details.push(event.otherDescription);
  return details;
}

function renderTreatmentEventCompact(event) {
  const detail = treatmentEventDetail(event).slice(0, 3).join(' · ');
  return `<div class="treatment-compact-row"><span class="treatment-dot treatment-${escapeHtml(event.eventType)}" aria-hidden="true"></span><div><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(treatmentTypeLabel[event.eventType] || event.eventType)} · ${escapeHtml(treatmentEventTime(event))}${detail ? ` · ${escapeHtml(detail)}` : ''}</small></div><button class="text-button" data-action="edit-treatment" data-id="${escapeHtml(event.id)}">查看</button></div>`;
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
     <div class="quick-actions" aria-label="快速记录"><button class="action-card" data-action="open-diet" data-kind="food">${actionIcon('food')}<strong>记录食物</strong><small>克数 · 参考范围</small></button><button class="action-card" data-action="open-beverage">${actionIcon('beverage')}<strong>记录饮品</strong><small>容量 · 可选数量</small></button><button class="action-card" data-action="open-measurement">${actionIcon('measurement')}<strong>记录尿酸</strong><small>实测值 · 原始单位</small></button><button class="action-card" data-action="open-diet" data-kind="recipe">${actionIcon('recipe')}<strong>记录菜谱</strong><small>成品克数 · 快速选择</small></button><button class="action-card" data-action="open-treatment">${actionIcon('treatment')}<strong>记录治疗</strong><small>日期 · 过程节点</small></button></div>
    <div class="section-heading"><h4>今天的记录</h4><small>${allEntries.length ? `${allEntries.length} 条 · 按时间倒序` : '从第一条记录开始'}</small></div>
     <div class="record-list">${allEntries.length ? allEntries.map(renderRecordRow).join('') : '<div class="empty-state"><strong>这一天还很安静</strong><span>用上面的入口记录第一条饮食、饮品或尿酸实测。</span></div>'}</div>
     <div class="section-heading treatment-day-heading"><h4>今天的治疗节点</h4><small>${day.treatmentEventCount ? `${day.treatmentEventCount} 条 · 独立时间线` : '还没有节点'}</small></div>
     <div class="treatment-day-preview">${day.treatmentEvents?.length ? day.treatmentEvents.slice(0, 4).map(renderTreatmentEventCompact).join('') + (day.treatmentEvents.length > 4 ? `<button class="text-button treatment-more" data-action="open-treatment-route">查看全部 ${day.treatmentEvents.length} 条</button>` : '') : '<div class="empty-state"><strong>还没有治疗节点</strong><span>检查、用药和症状变化可以分别记录，之后按类型筛选回看。</span></div>'}</div>
     ${renderGuidance(day)}
     <div class="info-strip">本页估算的是膳食嘌呤摄入负荷，不是个人血尿酸升高值，也不用于诊断或治疗。饮品容量单独统计，不抵扣嘌呤负荷。</div>`;
}

function renderRecordRow(entry) {
  if (entry.type === 'diet') return `<div class="record-row"><span class="record-marker" aria-hidden="true"></span><div class="record-main"><strong>${escapeHtml(entry.name)}</strong><small>${entry.kind === 'recipe' ? '菜谱' : '食物'} · ${formatNumber(entry.quantityG, 1)}g${entry.groupName ? ` · ${escapeHtml(entry.groupName)}` : ''}</small></div><div class="record-value">${formatRange(entry.contributionLow, entry.contributionHigh)}<small>${entry.contributionLow === null ? '暂无估算' : '录入时快照'}</small></div><div class="row-actions"><button data-action="edit-diet" data-id="${escapeHtml(entry.id)}" data-kind="${escapeHtml(entry.kind)}" aria-label="编辑">编辑</button><button data-action="delete-diet" data-id="${escapeHtml(entry.id)}" aria-label="删除">删除</button></div></div>`;
  if (entry.type === 'beverage') return `<div class="record-row"><span class="record-marker beverage" aria-hidden="true"></span><div class="record-main"><strong>${escapeHtml(entry.name)}</strong><small>饮品 · ${entry.quantity > 1 ? `${entry.amountMl / entry.quantity}mL × ${entry.quantity}` : `${entry.amountMl}mL`}</small></div><div class="record-value">${formatNumber(entry.amountMl, 0)}<small>mL · 不抵扣嘌呤</small></div><div class="row-actions"><button data-action="edit-beverage" data-id="${escapeHtml(entry.id)}" aria-label="编辑饮品记录">编辑</button><button data-action="delete-beverage" data-id="${escapeHtml(entry.id)}" aria-label="删除饮品记录">删除</button></div></div>`;
  const measurementContext = [entry.time || '仅记录日期', entry.sourceKind || '来源未填', entry.acuteFlare === true ? '急性发作期' : entry.acuteFlare === false ? '非急性发作期' : '发作状态未填'];
  const reference = entry.referenceLowOriginal !== null || entry.referenceHighOriginal !== null
    ? ` · 报告参考 ${formatNumber(entry.referenceLowOriginal, 2)}–${formatNumber(entry.referenceHighOriginal, 2)} ${entry.referenceUnitOriginal === 'mg/dL' ? 'mg/dL' : 'μmol/L'}`
    : '';
  return `<div class="record-row"><span class="record-marker urate" aria-hidden="true"></span><div class="record-main"><strong>血尿酸实测</strong><small>${measurementContext.map(escapeHtml).join(' · ')}</small></div><div class="record-value">${formatUrate(entry.valueUmolL)}<small>原始 ${formatNumber(entry.valueOriginal, 2)} ${escapeHtml(entry.unitOriginal)}${reference}</small></div><div class="row-actions"><button data-action="edit-measurement" data-id="${escapeHtml(entry.id)}" aria-label="编辑血尿酸实测">编辑</button><button data-action="delete-measurement" data-id="${escapeHtml(entry.id)}" aria-label="删除血尿酸实测">删除</button></div></div>`;
}

function renderTreatmentResult(result) {
  const value = result.resultText || (result.numericValue !== null && result.numericValue !== undefined ? `${formatNumber(result.numericValue, 3)}${result.unit ? ` ${result.unit}` : ''}` : '未填写结果');
  return `<div class="treatment-result-row"><strong>${escapeHtml(result.testName || '未命名项目')}</strong><span>${escapeHtml(value)}</span>${result.referenceRange ? `<small>参考范围：${escapeHtml(result.referenceRange)}</small>` : ''}${result.note ? `<small>${escapeHtml(result.note)}</small>` : ''}</div>`;
}

function renderTreatmentEventCard(event) {
  const details = treatmentEventDetail(event);
  return `<article class="treatment-event-card"><div class="treatment-event-marker treatment-${escapeHtml(event.eventType)}" aria-hidden="true"><span></span></div><div class="treatment-event-body"><header class="treatment-event-header"><div><span class="treatment-badge treatment-${escapeHtml(event.eventType)}">${escapeHtml(event.eventTypeLabel || treatmentTypeLabel[event.eventType] || event.eventType)}</span><time>${escapeHtml(treatmentEventTime(event))}</time></div><div class="row-actions"><button data-action="edit-treatment" data-id="${escapeHtml(event.id)}" aria-label="编辑${escapeHtml(event.title)}">编辑</button><button data-action="delete-treatment" data-id="${escapeHtml(event.id)}" aria-label="删除${escapeHtml(event.title)}">删除</button></div></header><h4>${escapeHtml(event.title)}</h4>${details.length ? `<p class="treatment-event-details">${details.map((detail) => `<span>${escapeHtml(detail)}</span>`).join('')}</p>` : ''}${event.results?.length ? `<div class="treatment-results"><strong>检查结果</strong>${event.results.map(renderTreatmentResult).join('')}</div>` : ''}${event.notes ? `<p class="treatment-event-note">${escapeHtml(event.notes)}</p>` : ''}</div></article>`;
}

function renderTreatmentTimeline(events) {
  if (!events?.length) {
    const hasFilters = Object.values(state.treatmentFilters || {}).some(Boolean);
    return '<div class="empty-state"><strong>' + (hasFilters ? '当前筛选条件下没有记录' : '还没有治疗记录') + '</strong><span>' + (hasFilters ? '可以清除筛选，或调整日期、类型和关键词。' : '从新增治疗记录开始，逐条保存检查、用药和症状变化。') + '</span></div>';
  }
  const groups = [];
  const grouped = new Map();
  events.forEach((event) => {
    if (!grouped.has(event.eventDate)) { grouped.set(event.eventDate, []); groups.push([event.eventDate, grouped.get(event.eventDate)]); }
    grouped.get(event.eventDate).push(event);
  });
  return `<div class="treatment-timeline">${groups.map(([date, items]) => `<section class="treatment-day-group"><div class="treatment-date-heading"><time>${escapeHtml(formatDate(date))}</time><span>${items.length} 条节点</span></div><div class="treatment-day-events">${items.map(renderTreatmentEventCard).join('')}</div></section>`).join('')}</div>`;
}

function renderTreatment() {
  const filters = state.treatmentFilters;
  const events = state.treatment || [];
  const hasFilters = Object.values(filters).some(Boolean);
  const filterSummary = hasFilters
    ? [filters.type ? treatmentTypeLabel[filters.type] : '全部类型', filters.from || filters.to ? `${filters.from || '最早'} 至 ${filters.to || '最新'}` : '', filters.q ? `关键词：${filters.q}` : ''].filter(Boolean).join(' · ')
    : '按日期、类型或关键词缩小范围';
  return `<div class="page-intro treatment-intro"><div><p class="eyebrow">CARE JOURNAL / FACTS IN ORDER</p><h3>把过程，一步一步留住。</h3><p>每一条都是独立节点；同一天的检查、用药和症状变化不会互相覆盖。这里记录事实，不判断疗效。</p></div><button class="button button-primary" data-action="open-treatment">新增治疗记录</button></div><details class="panel treatment-filter-panel" ${hasFilters ? 'open' : ''}><summary class="filter-summary"><span><strong>筛选时间线</strong><small>${escapeHtml(filterSummary)}</small></span><span>${events.length} 条</span></summary><form class="treatment-filters" data-form="treatment-filter"><div class="form-field"><label for="treatment-from">开始日期</label><input id="treatment-from" name="from" type="date" value="${escapeHtml(filters.from)}" /></div><div class="form-field"><label for="treatment-to">结束日期</label><input id="treatment-to" name="to" type="date" value="${escapeHtml(filters.to)}" /></div><div class="form-field"><label for="treatment-type">事件类型</label><select id="treatment-type" name="type"><option value="">全部类型</option>${treatmentTypes.map(([value, label]) => `<option value="${value}" ${filters.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="form-field treatment-search-field"><label for="treatment-q">关键词</label><input id="treatment-q" name="q" type="search" value="${escapeHtml(filters.q)}" placeholder="药品、医院、结果或备注" /></div><div class="treatment-filter-actions"><button class="button button-primary" type="submit">应用筛选</button><button class="button button-secondary" type="button" data-action="clear-treatment-filters">清除筛选</button></div></form></details><section class="panel treatment-timeline-panel"><div class="panel-header"><div><h4>${filters.type ? escapeHtml(treatmentTypeLabel[filters.type]) : '全部治疗节点'}</h4><p>${filters.from || filters.to ? `${filters.from || '最早'} 至 ${filters.to || '最新'}` : '按日期倒序，时间未填写的事件仍会保留。'}</p></div><span class="mono">${events.length} 条记录</span></div>${renderTreatmentTimeline(events)}</section><div class="info-strip treatment-boundary">治疗记录只保存你填写的过程信息，不自动解释检查结果，不判断药物是否有效，也不提供开始、停用或调整剂量的建议。</div>`;
}

function renderHistory() {
  const days = state.history || [];
  return `<div class="page-intro"><div><p class="eyebrow">DAY BY DAY / HISTORY</p><h3>给过去留一页。</h3><p>未记录的日期显示为空，不会被当作 0。</p></div><div class="date-control"><span>回看到</span><input id="history-date" type="date" value="${escapeHtml(state.currentDate)}" /></div></div><div class="panel"><div class="panel-header"><div><h4>最近 30 天</h4><p>饮食、饮品、实测和治疗节点共用真实日期；点开日期可继续修改。</p></div><span class="mono">${days.length} DAYS WITH DATA</span></div>${days.length ? `<div class="history-list">${days.map((day) => `<button class="history-day" data-action="open-history-day" data-date="${escapeHtml(day.date)}"><span class="history-day-main"><strong>${formatDate(day.date)}</strong><small>${day.dietEntries.length} 条饮食 · ${day.beverageEntries.length} 条饮品 · ${day.measurements.length} 条实测 · ${day.treatmentEventCount || 0} 条治疗</small></span><span class="history-day-right"><strong>${formatRange(day.summary.low, day.summary.high)}</strong><small>${formatNumber(day.beverage.totalMl, 0)}mL 饮品</small></span><span class="history-day-arrow" aria-hidden="true">›</span></button>`).join('')}</div>` : '<div class="empty-state"><strong>这段时间还没有记录</strong><span>切换到今日，先留下一条可回看的证据。</span></div>'}</div>`;
}

function renderStats() {
  const stats = state.stats || { measurements: [], daily: [], urateStats: {} };
  const measurements = stats.measurements || [];
  const latest = stats.urateStats?.latest;
  const previous = stats.urateStats?.previous;
  const diff = latest && previous ? latest.valueUmolL - previous.valueUmolL : null;
  const interval = latest && previous ? Math.round((Date.parse(`${latest.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`)) / 86400000) : null;
  const intervalLabel = interval === 0 ? '同日' : interval === null ? '' : `${interval}天`;
  const dailyRows = stats.daily || [];
  const beverageTotal = dailyRows.reduce((sum, row) => sum + (row.beverageTotalMl || 0), 0);
  const plainWaterTotal = dailyRows.reduce((sum, row) => sum + (row.plainWaterMl || 0), 0);
  const otherBeverageTotal = beverageTotal - plainWaterTotal;
  return `<div class="page-intro"><div><p class="eyebrow">OBSERVATION / NO CAUSAL CLAIMS</p><h3>看见变化，也保留边界。</h3><p>独立展示实测、膳食负荷和饮品容量；同期记录不能证明因果。</p></div><div class="period-switch">${[['30', '近 30 天'], ['90', '近 90 天'], ['365', '近 1 年'], ['all', '全部']].map(([value, label]) => `<button class="chip ${state.statsPeriod === value ? 'active' : ''}" data-action="stats-period" data-period="${value}">${label}</button>`).join('')}</div></div><div class="stat-layout"><section class="panel"><div class="panel-header"><div><h4>血尿酸实测趋势</h4><p>内部统一按 μmol/L 计算；本页统一显示为 ${preferredUrateUnit()}，记录详情保留原始单位。</p></div><span class="mono">${measurements.length} MEASUREMENTS</span></div><div class="metric-trio metrics-wide"><div><small>最新</small><strong>${latest ? formatUrate(latest.valueUmolL) : '—'}</strong></div><div><small>上一次 / 间隔</small><strong>${previous ? `${formatUrate(previous.valueUmolL)} · ${intervalLabel}` : '—'}</strong></div><div><small>两次差值</small><strong>${diff === null ? '—' : formatUrateDelta(diff)}</strong></div><div><small>记录数</small><strong>${stats.urateStats?.count || 0}</strong></div><div><small>最小 / 最大</small><strong>${stats.urateStats?.min === null || stats.urateStats?.min === undefined ? '—' : formatUrateMinMax(stats.urateStats.min, stats.urateStats.max)}</strong></div><div><small>中位数</small><strong>${stats.urateStats?.median === null || stats.urateStats?.median === undefined ? '—' : formatUrate(stats.urateStats.median)}</strong></div></div>${renderLineChart(measurements)}<div class="section-heading"><h4>可读数据表</h4><small>按测量日期，不补齐缺测日</small></div>${measurements.length ? `<table class="data-table"><caption class="sr-only">血尿酸实测数据</caption><thead><tr><th scope="col">日期</th><th scope="col">原始值</th><th scope="col">当前显示</th></tr></thead><tbody>${measurements.slice().reverse().map((row) => `<tr><td>${formatDate(row.date, false)}</td><td>${formatNumber(row.valueOriginal, 2)} ${escapeHtml(row.unitOriginal)}</td><td>${formatUrate(row.valueUmolL)}</td></tr>`).join('')}</tbody></table>` : '<div class="chart-empty compact-empty">还没有实测数据</div>'}</section><section class="panel"><div class="panel-header"><div><h4>饮食与饮品趋势</h4><p>只呈现饮食或饮品有记录的天；不把空白当作 0。</p></div><span class="mono">${stats.recordedDays || 0} / ${stats.totalDays || 0} 饮食/饮品记录日</span></div><div class="metric-trio metrics-wide"><div><small>区间饮品</small><strong>${formatNumber(beverageTotal, 0)}mL</strong></div><div><small>纯净水</small><strong>${formatNumber(plainWaterTotal, 0)}mL</strong></div><div><small>其他饮品</small><strong>${formatNumber(otherBeverageTotal, 0)}mL</strong></div></div>${renderBarChart(stats.daily)}<div class="section-heading"><h4>日数据</h4><small>嘌呤范围 · 饮品总量 · 纯净水 · 其他饮品</small></div>${stats.daily?.length ? `<table class="data-table"><caption class="sr-only">每日饮食与饮品数据</caption><thead><tr><th scope="col">日期</th><th scope="col">嘌呤</th><th scope="col">饮品</th><th scope="col">纯水</th><th scope="col">其他</th></tr></thead><tbody>${stats.daily.slice().reverse().map((row) => `<tr><td>${formatDate(row.date, false)}</td><td>${formatRange(row.purineLow, row.purineHigh)}</td><td>${formatNumber(row.beverageTotalMl, 0)}mL</td><td>${formatNumber(row.plainWaterMl, 0)}mL</td><td>${formatNumber((row.beverageTotalMl || 0) - (row.plainWaterMl || 0), 0)}mL</td></tr>`).join('')}</tbody></table>` : '<div class="chart-empty compact-empty">还没有饮食或饮品趋势</div>'}</section></div><section class="panel" style="margin-top:14px"><div class="panel-header"><div><h4>同期记录对照</h4><p>每次实测前的 1 / 3 / 7 个完整日；只展示同一时间窗中的记录。</p></div><span class="mono">CONTEXT ONLY</span></div>${stats.comparisons?.length ? `<div class="comparison-list">${stats.comparisons.slice().reverse().map((item) => `<div class="comparison-row"><header><span>${formatDate(item.measurement.date)} 实测 ${formatUrate(item.measurement.valueUmolL)}</span><span>不能证明因果</span></header><div class="comparison-windows">${item.windows.map((window) => `<div class="comparison-window"><small>前 ${window.days} 日 · ${window.totalCount ? window.coverage : '无饮食记录'}</small><strong>${formatRange(window.low, window.high)}</strong><small>${formatNumber(window.beverageTotalMl, 0)}mL · 纯水 ${formatNumber(window.plainWaterMl, 0)}mL · ${window.recordedDays} 天有饮食/饮品</small></div>`).join('')}</div></div>`).join('')}</div>` : '<div class="empty-state"><strong>有了尿酸实测，才会出现同期回看</strong><span>这个区域不会替你生成因果结论。</span></div>'}</section><div class="info-strip" style="margin-top:14px">以下为同期记录，仅供自我观察；它不能证明某种食物或饮品导致本次血尿酸变化。</div>`;
}

function renderLineChart(rows) {
  if (!rows.length) return '<div class="chart-empty">记录 1 次可以看到单点；至少 2 次才有变化趋势。</div>';
  const width = 640; const height = 215; const pad = { left: 32, right: 14, top: 18, bottom: 28 };
  const values = rows.map((row) => row.valueUmolL); const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 20;
  const firstDay = Date.parse(`${rows[0].date}T00:00:00Z`); const lastDay = Date.parse(`${rows.at(-1).date}T00:00:00Z`); const daySpan = Math.max(1, Math.round((lastDay - firstDay) / 86400000));
  const points = rows.map((row) => { const dayOffset = Math.max(0, Math.round((Date.parse(`${row.date}T00:00:00Z`) - firstDay) / 86400000)); const x = pad.left + (rows.length === 1 ? (width - pad.left - pad.right) / 2 : dayOffset / daySpan * (width - pad.left - pad.right)); const y = pad.top + (max - row.valueUmolL) / spread * (height - pad.top - pad.bottom); return { x, y, row }; });
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  return `<div class="chart-wrap"><svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="血尿酸实测趋势图，单位 ${preferredUrateUnit()}"><line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${pad.top}" y2="${pad.top}"/><line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${height / 2}" y2="${height / 2}"/><line class="grid-line" x1="${pad.left}" x2="${width - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}"/><text x="0" y="${pad.top + 4}" font-size="10">${formatNumber(urateValueInPreferredUnit(max), 1)}</text><text x="0" y="${height - pad.bottom + 4}" font-size="10">${formatNumber(urateValueInPreferredUnit(min), 1)}</text><path class="trend-line" d="${path}"/>${points.map((point) => `<circle class="trend-dot" cx="${point.x}" cy="${point.y}" r="5"><title>${point.row.date} ${formatUrate(point.row.valueUmolL)}</title></circle>`).join('')}<text x="${pad.left}" y="${height - 5}" font-size="9">${rows[0].date}</text><text text-anchor="end" x="${width - pad.right}" y="${height - 5}" font-size="9">${rows.at(-1).date}</text></svg></div>`;
}

function renderBarChart(rows) {
  if (!rows?.length) return '<div class="chart-empty">有记录后会显示每日区间。</div>';
  const max = Math.max(...rows.map((row) => row.purineHigh || 0), 1);
  return `<div class="bar-chart" role="img" aria-label="每日膳食嘌呤估算区间图">${rows.slice(-14).map((row) => { const low = Math.max(0, row.purineLow || 0); const high = Math.max(low, row.purineHigh || 0); const bottom = (low / max) * 145; const height = Math.max(3, ((high - low) / max) * 145); return `<div class="bar-column"><div class="bar-track"><div class="bar-range" style="bottom:${bottom}px;height:${height}px" title="${formatRange(row.purineLow, row.purineHigh)}"><span class="sr-only">${escapeHtml(row.date)} ${formatRange(row.purineLow, row.purineHigh)}</span></div></div><small>${row.date.slice(5)}</small></div>`; }).join('')}</div>`;
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

function filterLibraryItems(kind, items) {
  const selected = state.manageGroupFilters[kind] || '';
  if (!selected) return items;
  if (selected === '__ungrouped') return items.filter((item) => !item.groupId);
  return items.filter((item) => item.groupId === selected);
}

function libraryCountText(kind, visibleCount) {
  const total = state.bootstrap.counts[`${kind}s`];
  return state.manageGroupFilters[kind] ? `当前筛选 ${visibleCount} / ${total} 项可选` : `当前 ${total} 项可选`;
}

function renderLibraryGroupFilter(kind, label) {
  const groups = state.bootstrap.groups[`${kind}s`] || [];
  const selected = state.manageGroupFilters[kind] || '';
  return `<div class="library-filter" data-library-filter="${escapeHtml(kind)}"><label for="library-group-filter-${escapeHtml(kind)}">按分组筛选${escapeHtml(label)}</label><select id="library-group-filter-${escapeHtml(kind)}" data-library-group-filter="${escapeHtml(kind)}" aria-label="按分组筛选${escapeHtml(label)}"><option value="" ${selected === '' ? 'selected' : ''}>全部${escapeHtml(label)}</option><option value="__ungrouped" ${selected === '__ungrouped' ? 'selected' : ''}>未分组</option>${groups.map((group) => `<option value="${escapeHtml(group.id)}" ${selected === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}</select></div>`;
}

function renderFoodLibrary() {
  const foods = filterLibraryItems('food', state.bootstrap.foods);
  return `<div class="manage-layout manage-library-layout"><section class="panel"><div class="panel-header"><div><h4>食物参考库</h4><p>${libraryCountText('food', foods.length)}；“待复核”不是 VERIFIED。</p></div><button class="button button-primary" data-action="open-library-form" data-type="food">新增食物</button></div>${renderLibraryGroupFilter('food', '食物')}<div class="library-list" data-library-list="food">${foods.map((food) => `<div class="library-item"><div><strong>${escapeHtml(food.name)}</strong><small>${escapeHtml(food.groupName || '未分组')} · ${escapeHtml(food.state)} · ${food.purineLow === null ? '暂无参考值' : `${formatRange(food.purineLow, food.purineHigh)} / 100g`} </small></div><div><span class="status-label ${food.verificationStatus === 'PREPARED' ? 'prepared' : ''}">${escapeHtml(food.verificationStatus)}</span><button class="text-button" data-action="open-library-form" data-type="food" data-id="${escapeHtml(food.id)}">编辑</button><button class="text-button" data-action="delete-library-item" data-kind="food" data-id="${escapeHtml(food.id)}">删除</button></div></div>`).join('')}</div></section><section class="panel">${renderKindGroupManager('food', '食物')}<div class="panel-divider"></div><div class="panel-header"><div><h4>来源状态</h4><p>只有逐项人工核对后才能标为 VERIFIED。</p></div><span class="mono">SOURCES</span></div>${state.bootstrap.sources.map((source) => `<div class="library-item"><div><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.publisher || '')} · ${escapeHtml(source.version || '')}</small></div><span class="status-label prepared">登记</span></div>`).join('')}<button class="button button-secondary button-block" data-action="open-source-form">登记新来源</button></section></div>`;
}

function renderRecipeLibrary() {
  const recipes = filterLibraryItems('recipe', state.bootstrap.recipes);
  return `<div class="manage-layout manage-library-layout"><section class="panel"><div class="panel-header"><div><h4>菜谱版本</h4><p>按配料计算与手工范围分开；菜谱不能嵌套菜谱。</p></div><button class="button button-primary" data-action="open-library-form" data-type="recipe">新增菜谱</button></div>${renderLibraryGroupFilter('recipe', '菜谱')}<div class="library-list" data-library-list="recipe">${recipes.length ? recipes.map((recipe) => `<div class="library-item"><div><strong>${escapeHtml(recipe.name)}</strong><small>${escapeHtml(recipe.groupName || '未分组')} · ${recipe.mode === 'ingredients' ? '按配料计算' : '手工估计'} · ${recipe.purineLow === null ? '暂无每 100g 估算' : `${formatRange(recipe.purineLow, recipe.purineHigh)} / 100g`}</small></div><div><span class="status-label ${recipe.verificationStatus === 'PREPARED' ? 'prepared' : ''}">${escapeHtml(recipe.verificationStatus)}</span><button class="text-button" data-action="open-library-form" data-type="recipe" data-id="${escapeHtml(recipe.id)}">编辑</button><button class="text-button" data-action="delete-library-item" data-kind="recipe" data-id="${escapeHtml(recipe.id)}">删除</button></div></div>`).join('') : `<div class="empty-state"><strong>${state.bootstrap.recipes.length ? '当前分组没有菜谱' : '还没有菜谱'}</strong><span>可以先创建一个按配料计算的菜谱。</span></div>`}</div></section><section class="panel">${renderKindGroupManager('recipe', '菜谱')}</section></div>`;
}

function renderBeverageLibrary() {
  const beverages = filterLibraryItems('beverage', state.bootstrap.beverages);
  return `<div class="manage-layout manage-library-layout"><section class="panel"><div class="panel-header"><div><h4>饮品目录</h4><p>系统预置只是方便开始，不代表医学推荐；含糖版本请单独建条目。</p></div><button class="button button-primary" data-action="open-library-form" data-type="beverage">新增饮品</button></div>${renderLibraryGroupFilter('beverage', '饮品')}<div class="library-list" data-library-list="beverage">${beverages.length ? beverages.map((beverage) => `<div class="library-item"><div><strong>${escapeHtml(beverage.name)}</strong><small>${escapeHtml(beverage.groupName || '未分组')} · ${beverage.isPlainWater ? '纯净水' : '其他饮品'}${beverage.containsSugar ? ' · 含糖' : ''}</small></div><div><span class="status-label">${beverage.system ? '系统预置' : '自建'}</span><button class="text-button" data-action="open-library-form" data-type="beverage" data-id="${escapeHtml(beverage.id)}">编辑</button>${beverage.system ? '' : `<button class="text-button" data-action="delete-library-item" data-kind="beverage" data-id="${escapeHtml(beverage.id)}">删除</button>`}</div></div>`).join('') : `<div class="empty-state"><strong>${state.bootstrap.beverages.length ? '当前分组没有饮品' : '还没有饮品'}</strong><span>可以先创建一个饮品资料。</span></div>`}</div></section><section class="panel">${renderKindGroupManager('beverage', '饮品')}</section></div>`;
}

function renderKindGroupManager(kind, label) {
  const groups = state.bootstrap.groups[`${kind}s`] || [];
  return `<div class="kind-group-manager" data-group-manager="${escapeHtml(kind)}"><div class="panel-header"><div><h4>${escapeHtml(label)}分组</h4><p>只管理${escapeHtml(label)}；与其他标签页的分组彼此独立。</p></div><button class="button button-secondary" data-action="open-group-form" data-kind="${escapeHtml(kind)}">新建${escapeHtml(label)}分组</button></div><div class="library-list">${groups.map((group) => `<div class="library-item"><div><strong>${escapeHtml(group.name)}</strong><small>${group.system ? '系统预置分组' : `自建${escapeHtml(label)}分组`}</small></div><div><button class="text-button" data-action="manage-group-filter" data-kind="${escapeHtml(kind)}" data-group-id="${escapeHtml(group.id)}">筛选</button>${group.system ? '<span class="status-label">系统预置</span>' : `<button class="text-button" data-action="open-group-form" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(group.id)}">编辑</button><button class="text-button" data-action="delete-group" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(group.id)}">删除</button>`}</div></div>`).join('')}</div><div class="group-unassigned"><div><strong>未分组</strong><span>新增或编辑${escapeHtml(label)}时选择“未分组”即可，不需要专门创建这个分组。</span></div><button class="text-button" data-action="manage-group-filter" data-kind="${escapeHtml(kind)}" data-group-id="__ungrouped">筛选</button></div></div>`;
}

function renderSettingsLibrary() {
  const settings = state.bootstrap.settings;
  const backupAlert = state.bootstrap.backupAlert;
  const portions = ['food', 'recipe', 'beverage'].map((kind) => `<div class="form-field"><label>${kind === 'food' ? '食物' : kind === 'recipe' ? '菜谱' : '饮品'}快捷模板（${kind === 'beverage' ? 'mL' : 'g'}）</label><div class="preset-row">${state.bootstrap.portions.filter((item) => item.kind === kind).map((item) => `<input class="portion-input" data-kind="${escapeHtml(kind)}" data-id="${escapeHtml(item.id)}" type="number" min="0.1" step="0.1" value="${escapeHtml(item.value)}" aria-label="${escapeHtml(kind)}模板" style="width:78px" />`).join('')}</div></div>`).join('');
  const sessions = state.sessions.length ? `<div class="library-list">${state.sessions.map((session) => `<div class="library-item"><div><strong>${session.device_label ? escapeHtml(session.device_label.slice(0, 42)) : '未命名设备'}</strong><small>创建 ${escapeHtml(session.created_at)} · 最后使用 ${escapeHtml(session.last_used_at)} · 到期 ${escapeHtml(session.expires_at)}</small></div><div><span class="status-label ${session.revoked_at ? '' : 'prepared'}">${session.revoked_at ? '已撤销' : '有效'}</span>${session.revoked_at ? '' : `<button class="text-button" data-action="revoke-session" data-id="${escapeHtml(session.id)}">撤销</button>`}</div></div>`).join('')}</div>` : '<div class="empty-state"><strong>没有可信设备</strong><span>当前浏览器验证后会出现在这里。</span></div>';
  return `<div class="settings-hub"><details class="panel settings-section" open><summary><span><strong>显示与快捷录入</strong><small>首选单位、饮水记录目标和快捷份量</small></span><span class="details-toggle" aria-hidden="true">展开</span></summary><div class="settings-section-body"><form data-form="settings" class="settings-stack"><div class="setting-row"><div><label for="setting-unit">血尿酸首选单位</label><small>只改变显示，不修改历史原始数据。</small></div><select id="setting-unit" name="defaultUrateUnit" style="max-width:130px"><option value="umol/L" ${settings.defaultUrateUnit === 'umol/L' ? 'selected' : ''}>μmol/L</option><option value="mg/dL" ${settings.defaultUrateUnit === 'mg/dL' ? 'selected' : ''}>mg/dL</option></select></div><div class="setting-row"><div><label for="setting-water">饮水目标（mL/日）</label><small>心肾功能或限液情况不确定时，先咨询专业人员。</small></div><input id="setting-water" name="waterGoalMl" type="number" min="1" value="${settings.waterGoalMl || ''}" placeholder="可留空" style="max-width:130px" /></div><button class="button button-primary" type="submit">保存显示设置</button></form><form data-form="portions" class="settings-stack settings-subsection"><div class="panel-header"><div><h4>快捷份量模板</h4><p>自定义值仍可在录入时直接输入。</p></div></div>${portions}<button class="button button-secondary" type="submit">保存快捷份量</button></form></div></details><details class="panel settings-section"><summary><span><strong>备份与迁移</strong><small>完整导出、CSV、SQLite 快照与 JSON 恢复</small></span><span class="details-toggle" aria-hidden="true">展开</span></summary><div class="settings-section-body settings-stack"><p class="section-note">完整导出不包含口令、设备凭证或服务器密钥。ZIP 用于归档；网页恢复请选择完整 JSON 导出。</p><button class="button button-secondary button-block" data-action="download-export" data-format="json">下载完整 JSON（可用于恢复）</button><button class="button button-secondary button-block" data-action="download-export" data-format="zip">下载 ZIP 归档</button><button class="button button-secondary button-block" data-action="download-csv" data-format="urate">导出血尿酸 CSV</button><button class="button button-secondary button-block" data-action="download-csv" data-format="daily-summary">导出每日汇总 CSV</button><button class="button button-secondary button-block" data-action="create-snapshot">创建 SQLite 安全快照</button><label class="button button-secondary button-block restore-picker">选择完整 JSON 并预览恢复<input id="restore-file" type="file" accept="application/json,.json" hidden /></label><div id="backup-status" class="form-hint" role="status" aria-live="polite"></div><div class="danger-zone"><strong>危险操作</strong><span>删除前会尝试备份，并要求输入完整确认短语。</span><button class="button button-danger button-block" data-action="delete-all-data">删除全部个人记录…</button></div></div></details><details class="panel settings-section"><summary><span><strong>访问口令与可信设备</strong><small>修改口令、查看或撤销已经信任的设备</small></span><span class="details-toggle" aria-hidden="true">展开</span></summary><div class="settings-section-body security-settings"><section><div class="panel-header"><div><h4>修改访问口令</h4><p>修改后所有可信设备立即失效，服务重启仍保持新口令。</p></div></div><form data-form="password" class="settings-stack"><div class="form-field"><label for="new-shared-password">新口令（至少 8 个字符）</label><input id="new-shared-password" name="newPassword" type="password" minlength="8" autocomplete="new-password" required /></div><div class="form-field"><label for="confirm-shared-password">再次输入新口令</label><input id="confirm-shared-password" name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required /></div><button class="button button-danger" type="submit">修改共享访问口令…</button></form></section><section><div class="panel-header"><div><h4>可信设备</h4><p>撤销后旧 Cookie 下一次请求立即失效。</p></div><button class="text-button" data-action="revoke-all-sessions">撤销全部…</button></div>${sessions}</section></div></details>${backupAlert ? `<div class="info-strip">最近一次备份或异机复制出现失败：${escapeHtml(backupAlert.status)}。请检查备份目录、权限和异机目标，直到后续成功备份清除告警。</div>` : ''}<div class="info-strip">自动备份只有在成功恢复验证后才能标记 VERIFIED。当前页面可以生成本地快照和可移植导出；异机复制与真实目标服务器迁移仍需按部署环境演练。</div></div>`;
}

function getFocusable(root) {
  return $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
    .filter((node) => !node.hidden && node.getClientRects().length > 0);
}

function ensureFormLabels(root) {
  $$('label:not([for])', root).forEach((label) => {
    if (label.querySelector('input, select, textarea')) return;
    const field = label.closest('.form-field, .setting-row');
    const control = field?.querySelector('input:not([type="hidden"]), select, textarea');
    if (!control || control.getAttribute('aria-label') || control.getAttribute('aria-labelledby')) return;
    if (!control.id) control.id = `generated-field-${++generatedFieldId}`;
    label.htmlFor = control.id;
  });
}

function openModal(title, subtitle, content, context = {}) {
  state.modalContext = context;
  modalTrigger = document.activeElement;
  $('#toast-region').replaceChildren();
  const titleId = `modal-title-${Date.now()}`;
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1"><div class="modal-header"><div><h3 id="${titleId}">${escapeHtml(title)}</h3><p>${escapeHtml(subtitle || '')}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭${escapeHtml(title)}">×</button></div>${content}</section></div>`;
  ensureFormLabels($('.modal'));
  const form = $('.modal form[data-form]');
  if (form && !form.dataset.id && ['diet', 'beverage', 'measurement', 'treatment'].includes(form.dataset.form)) form.dataset.clientId = crypto.randomUUID();
  document.body.style.overflow = 'hidden';
  $('#app').inert = true;
  $('#gate').inert = true;
  requestAnimationFrame(() => $('.modal')?.focus({ preventScroll: true }));
}

function closeModal() {
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
  $('#app').inert = false;
  $('#gate').inert = false;
  state.modalContext = null;
  if (modalTrigger && document.contains(modalTrigger)) modalTrigger.focus({ preventScroll: true });
  modalTrigger = null;
}

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
  if (edit && !beverage) {
    const select = $('[data-form="beverage"] [name="beverageId"]');
    select?.prepend(new Option(`${edit.name} · 已归档（保留当前）`, edit.beverageId, true, true));
  }
  updateBeveragePreview();
}

function updateBeveragePreview() { const form = $('[data-form="beverage"]'); if (!form) return; const amount = Number($('[name="amountMl"]', form).value); const quantity = Number($('[name="quantity"]', form).value); $('.beverage-preview', form).textContent = amount > 0 && quantity > 0 ? `${formatNumber(amount * quantity, 0)}mL` : '—'; }

function openMeasurementModal(edit = null) {
  openModal(edit ? '修改尿酸实测' : '记录尿酸实测', '保存原始输入与规范化值；换算只用于统一统计口径，不作医学解释。', `<form data-form="measurement" data-id="${escapeHtml(edit?.id || '')}"><div class="form-grid"><div class="form-field"><label>测量日期</label><input name="date" type="date" value="${escapeHtml(edit?.date || state.currentDate)}" required /></div><div class="form-field"><label>测量时间（可选）</label><input name="time" type="time" value="${escapeHtml(edit?.time || '')}" /></div><div class="form-field"><label>原始数值</label><input name="valueOriginal" type="number" min="0.01" step="0.01" value="${escapeHtml(edit?.valueOriginal || '')}" required /></div><div class="form-field"><label>原始单位</label><select name="unitOriginal"><option value="umol/L" ${edit?.unitOriginal !== 'mg/dL' ? 'selected' : ''}>μmol/L</option><option value="mg/dL" ${edit?.unitOriginal === 'mg/dL' ? 'selected' : ''}>mg/dL</option></select></div><div class="form-field"><label>空腹状态</label><select name="fasting"><option value="unknown" ${!edit || edit.fasting === 'unknown' ? 'selected' : ''}>未知</option><option value="fasting" ${edit?.fasting === 'fasting' ? 'selected' : ''}>空腹</option><option value="non_fasting" ${edit?.fasting === 'non_fasting' ? 'selected' : ''}>非空腹</option></select></div><div class="form-field"><label>来源</label><select name="sourceKind"><option value="" ${!edit?.sourceKind ? 'selected' : ''}>未填写</option><option value="医院检验">医院检验</option><option value="体检">体检</option><option value="家用设备">家用设备</option><option value="其他">其他</option></select></div><div class="form-field full"><label>检测机构或设备名称（可选）</label><input name="facility" value="${escapeHtml(edit?.facility || '')}" placeholder="例如：某医院检验科" /></div><div class="form-field"><label>报告参考下限（可选）</label><input name="referenceLowOriginal" type="number" min="0" step="0.01" value="${escapeHtml(edit?.referenceLowOriginal ?? '')}" /></div><div class="form-field"><label>报告参考上限（可选）</label><input name="referenceHighOriginal" type="number" min="0" step="0.01" value="${escapeHtml(edit?.referenceHighOriginal ?? '')}" /></div><div class="form-field full"><label>备注</label><textarea name="note" placeholder="不记录药物建议；只记可回看的事实。">${escapeHtml(edit?.note || '')}</textarea></div></div><div class="preview-card"><small>保存前换算预览</small><strong class="urate-preview">请输入数值</strong><p>固定换算：μmol/L = mg/dL × 59.48。</p></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">${edit ? '保存修改' : '保存实测'}</button></div></form>`, { type: 'measurement' });
  const form = $('[data-form="measurement"]');
  $('[name="fasting"]', form)?.closest('.form-field')?.insertAdjacentHTML('afterend', `<div class="form-field"><label for="measurement-acute-flare">是否处于急性发作期</label><select id="measurement-acute-flare" name="acuteFlare"><option value="" ${edit?.acuteFlare === null || edit?.acuteFlare === undefined ? 'selected' : ''}>未知</option><option value="true" ${edit?.acuteFlare === true ? 'selected' : ''}>是</option><option value="false" ${edit?.acuteFlare === false ? 'selected' : ''}>否</option></select></div>`);
  $('[name="referenceHighOriginal"]', form)?.closest('.form-field')?.insertAdjacentHTML('afterend', `<div class="form-field"><label for="measurement-reference-unit">报告参考范围单位</label><select id="measurement-reference-unit" name="referenceUnitOriginal"><option value="umol/L" ${edit?.referenceUnitOriginal !== 'mg/dL' ? 'selected' : ''}>μmol/L</option><option value="mg/dL" ${edit?.referenceUnitOriginal === 'mg/dL' ? 'selected' : ''}>mg/dL</option></select></div>`);
  if (edit?.sourceKind) $('[name="sourceKind"]', form).value = edit.sourceKind;
  ensureFormLabels(form);
  updateUratePreview();
}

function updateUratePreview() { const form = $('[data-form="measurement"]'); if (!form) return; const value = Number($('[name="valueOriginal"]', form).value); const unit = $('[name="unitOriginal"]', form).value; $('.urate-preview', form).textContent = value > 0 ? `${formatNumber(value, 2)} ${unit} = ${formatNumber(unit === 'mg/dL' ? value * 59.48 : value, 2)} μmol/L` : '请输入数值'; }

function treatmentValue(edit, key) { return escapeHtml(edit?.[key] ?? ''); }

function renderTreatmentResultInput(result = null) {
  return `<div class="treatment-result-input" data-treatment-result-row><div class="form-field"><label>检查项目</label><input name="testName" value="${treatmentValue(result, 'testName')}" placeholder="例如：血尿酸" /></div><div class="form-field"><label>结果原文</label><input name="resultText" value="${treatmentValue(result, 'resultText')}" placeholder="保留报告原文" /></div><div class="form-field"><label>数值（可选）</label><input name="numericValue" type="number" step="any" value="${treatmentValue(result, 'numericValue')}" /></div><div class="form-field"><label>单位</label><input name="unit" value="${treatmentValue(result, 'unit')}" placeholder="例如：μmol/L" /></div><div class="form-field"><label>参考范围</label><input name="referenceRange" value="${treatmentValue(result, 'referenceRange')}" placeholder="按报告填写" /></div><div class="form-field"><label>备注</label><input name="note" value="${treatmentValue(result, 'note')}" /></div><button class="icon-button treatment-result-remove" type="button" data-action="remove-treatment-result" aria-label="移除检查结果">×</button></div>`;
}

function addTreatmentResultRow(result = null) {
  const root = $('#treatment-result-rows');
  if (root) {
    root.insertAdjacentHTML('beforeend', renderTreatmentResultInput(result));
    ensureFormLabels(root.lastElementChild);
  }
}

function toggleTreatmentSections(form) {
  if (!form) return;
  const type = $('[name="eventType"]', form)?.value || '';
  $$('[data-treatment-types]', form).forEach((section) => {
    const visible = section.dataset.treatmentTypes.split(',').includes(type);
    section.hidden = !visible;
    $$('input, select, textarea', section).forEach((input) => { input.disabled = !visible; });
  });
  $$('[data-treatment-only]', form).forEach((field) => {
    const visible = field.dataset.treatmentOnly === type;
    field.hidden = !visible;
    $$('input, select, textarea', field).forEach((input) => { input.disabled = !visible; });
  });
}

function openTreatmentModal(edit = null) {
  const currentType = edit?.eventType || 'flare';
  openModal(edit ? '修改治疗记录' : '新增治疗记录', '日期和类型必填；其他信息按需要填写。记录事实，不判断疗效。', `<form data-form="treatment" data-id="${escapeHtml(edit?.id || '')}"><div class="form-grid"><div class="form-field"><label for="treatment-event-date">事件日期</label><input id="treatment-event-date" name="eventDate" type="date" value="${treatmentValue(edit, 'eventDate') || escapeHtml(state.currentDate)}" required /></div><div class="form-field"><label for="treatment-event-time">事件时间（可选）</label><input id="treatment-event-time" name="eventTime" type="time" value="${treatmentValue(edit, 'eventTime')}" /></div><div class="form-field full"><label for="treatment-event-type">事件类型</label><select id="treatment-event-type" name="eventType" required>${treatmentTypes.map(([value, label]) => `<option value="${value}" ${currentType === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="form-field full"><label for="treatment-title">标题（可选）</label><input id="treatment-title" name="title" value="${treatmentValue(edit, 'title')}" placeholder="留空时使用事件类型" /></div></div><div class="treatment-form-section" data-treatment-types="flare,symptom_change"><div class="section-heading"><h4>症状信息</h4><small>可留空</small></div><div class="form-grid"><div class="form-field"><label>变化状态</label><select name="symptomState"><option value="" ${!edit?.symptomState ? 'selected' : ''}>未填写</option><option value="缓解" ${edit?.symptomState === '缓解' ? 'selected' : ''}>缓解</option><option value="无明显变化" ${edit?.symptomState === '无明显变化' ? 'selected' : ''}>无明显变化</option><option value="加重" ${edit?.symptomState === '加重' ? 'selected' : ''}>加重</option><option value="其他" ${edit?.symptomState === '其他' ? 'selected' : ''}>其他</option></select></div><div class="form-field"><label>严重程度（0–10）</label><input name="severity" type="number" min="0" max="10" step="0.1" value="${treatmentValue(edit, 'severity')}" /></div><div class="form-field full"><label>症状描述</label><textarea name="symptomDescription" placeholder="例如：红肿、疼痛、活动受限等">${treatmentValue(edit, 'symptomDescription')}</textarea></div></div></div><div class="treatment-form-section" data-treatment-types="flare"><div class="form-field"><label>发作部位</label><input name="symptomSite" value="${treatmentValue(edit, 'symptomSite')}" placeholder="例如：右脚大拇趾" /></div></div><div class="treatment-form-section" data-treatment-types="oral_medication,topical_medication"><div class="section-heading"><h4>用药信息</h4><small>不建立药品推荐</small></div><div class="form-grid"><div class="form-field full"><label>药品或产品名称</label><input name="medicineName" value="${treatmentValue(edit, 'medicineName')}" placeholder="按包装或医嘱填写" /></div><div class="form-field"><label>剂量</label><input name="dosage" value="${treatmentValue(edit, 'dosage')}" placeholder="例如：1" /></div><div class="form-field"><label>剂量单位</label><input name="dosageUnit" value="${treatmentValue(edit, 'dosageUnit')}" placeholder="例如：片、mg" /></div><div class="form-field"><label>频次</label><input name="frequency" value="${treatmentValue(edit, 'frequency')}" placeholder="例如：每日 2 次" /></div><div class="form-field"><label>开始日期</label><input name="startDate" type="date" value="${treatmentValue(edit, 'startDate')}" /></div><div class="form-field"><label>结束日期</label><input name="endDate" type="date" value="${treatmentValue(edit, 'endDate')}" /></div><div class="form-field full" data-treatment-only="topical_medication"><label>涂抹部位</label><input name="applicationSite" value="${treatmentValue(edit, 'applicationSite')}" placeholder="例如：右脚踝" /></div><div class="form-field full"><label>使用说明 / 医嘱原文</label><textarea name="instructions" placeholder="只记录已知信息，不填写自行推断的建议">${treatmentValue(edit, 'instructions')}</textarea></div></div></div><div class="treatment-form-section" data-treatment-types="hospital_check"><div class="section-heading"><h4>检查信息</h4><small>结果原文优先保留</small></div><div class="form-grid"><div class="form-field"><label>医院 / 机构</label><input name="facility" value="${treatmentValue(edit, 'facility')}" /></div><div class="form-field"><label>科室</label><input name="department" value="${treatmentValue(edit, 'department')}" /></div><div class="form-field"><label>医生（可选）</label><input name="clinician" value="${treatmentValue(edit, 'clinician')}" /></div><div class="form-field"><label>检查名称</label><input name="testName" value="${treatmentValue(edit, 'testName')}" placeholder="例如：血尿酸、肾功能" /></div><div class="form-field full"><label>报告结论（可选）</label><textarea name="reportConclusion" placeholder="按报告或医生说明记录">${treatmentValue(edit, 'reportConclusion')}</textarea></div><div class="form-field"><label>下次复诊日期</label><input name="followUpDate" type="date" value="${treatmentValue(edit, 'followUpDate')}" /></div></div><div class="section-heading treatment-results-heading"><h4>检查结果（可选）</h4><button type="button" class="button button-secondary" data-action="add-treatment-result">＋ 添加结果</button></div><div id="treatment-result-rows"></div></div><div class="treatment-form-section" data-treatment-types="follow_up"><div class="section-heading"><h4>复诊计划</h4><small>未来日期可直接保存</small></div><div class="form-grid"><div class="form-field full"><label>计划事项</label><input name="planItem" value="${treatmentValue(edit, 'planItem')}" placeholder="例如：复查血尿酸和肾功能" /></div><div class="form-field"><label>医院 / 机构</label><input name="facility" value="${treatmentValue(edit, 'facility')}" /></div><div class="form-field"><label>科室</label><input name="department" value="${treatmentValue(edit, 'department')}" /></div><div class="form-field"><label>计划日期</label><input name="followUpDate" type="date" value="${treatmentValue(edit, 'followUpDate')}" /></div></div></div><div class="treatment-form-section" data-treatment-types="other"><div class="section-heading"><h4>其他信息</h4><small>按自己的语言记录</small></div><div class="form-grid"><div class="form-field full"><label>事件名称</label><input name="otherName" value="${treatmentValue(edit, 'otherName')}" /></div><div class="form-field full"><label>详细描述</label><textarea name="otherDescription">${treatmentValue(edit, 'otherDescription')}</textarea></div></div></div><div class="form-field full treatment-notes-field"><label>备注</label><textarea name="notes" placeholder="只记可回看的事实">${treatmentValue(edit, 'notes')}</textarea></div><div class="treatment-form-hint">只有日期和类型是必填项。医院检查可以添加多条结果；空白字段不会被自动补全。</div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">取消</button><button type="submit" class="button button-primary">${edit ? '保存修改' : '保存记录'}</button></div></form>`, { type: 'treatment' });
  if (edit?.results?.length) edit.results.forEach((result) => addTreatmentResultRow(result));
  toggleTreatmentSections($('[data-form="treatment"]'));
}

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
  const row = document.createElement('div'); row.className = 'ingredient-row'; row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) 100px 44px;gap:7px;margin-bottom:7px;';
  row.innerHTML = `<select name="foodVersionId" aria-label="选择配料食物" required><option value="">选择食物版本</option>${state.bootstrap.foods.map((food) => `<option value="${escapeHtml(food.versionId)}" ${food.versionId === item?.foodVersionId ? 'selected' : ''}>${escapeHtml(food.name)} · ${food.purineLow === null ? '未知' : formatRange(food.purineLow, food.purineHigh)}</option>`).join('')}</select><input name="grams" aria-label="配料克数" type="number" min="0.1" step="0.1" value="${escapeHtml(item?.grams || '')}" placeholder="克数" required /><button class="icon-button" type="button" data-action="remove-ingredient" aria-label="移除配料">×</button>`;
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
  if (state.modalContext) closeModal();
  closeMobileMenu();
  $('#gate').inert = false;
  $('#gate').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#login-message').textContent = message; state.csrf = null;
  requestAnimationFrame(() => $('#login-password')?.focus({ preventScroll: true }));
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

function findTreatmentEvent(id) {
  return (state.treatment || []).find((item) => item.id === id)
    || (state.day?.treatmentEvents || []).find((item) => item.id === id)
    || null;
}

function collectTreatmentResults(form) {
  return $$('.treatment-result-input', form).map((row) => ({
    testName: $('[name="testName"]', row)?.value || '',
    resultText: $('[name="resultText"]', row)?.value || '',
    numericValue: $('[name="numericValue"]', row)?.value || '',
    unit: $('[name="unit"]', row)?.value || '',
    referenceRange: $('[name="referenceRange"]', row)?.value || '',
    note: $('[name="note"]', row)?.value || '',
  }));
}

function setFormPending(form, pending) {
  form.dataset.pending = String(pending);
  form.setAttribute('aria-busy', String(pending));
  const submit = form.querySelector('button[type="submit"]');
  if (!submit) return;
  if (pending) {
    submit.dataset.originalLabel = submit.textContent;
    submit.textContent = form.dataset.form === 'treatment-filter' ? '正在筛选…' : '正在保存…';
    submit.disabled = true;
  } else {
    submit.textContent = submit.dataset.originalLabel || submit.textContent;
    submit.disabled = false;
    delete submit.dataset.originalLabel;
  }
}

function showFormError(form, message) {
  form.querySelector('.form-error')?.remove();
  const node = document.createElement('div');
  node.className = 'form-error';
  node.role = 'alert';
  node.tabIndex = -1;
  node.textContent = `${message}。请检查已填写内容后重试。`;
  const actions = form.querySelector('.modal-actions');
  if (actions) actions.before(node); else form.appendChild(node);
  node.focus({ preventScroll: false });
}

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'retry-route') { await renderCurrentRoute(); return; }
    if (action === 'close-modal') { if (event.target.classList.contains('modal-backdrop') || button.classList.contains('modal-close') || button.classList.contains('button-secondary')) closeModal(); return; }
    if (action === 'shift-date') { state.currentDate = addDays(state.currentDate, Number(button.dataset.days)); await renderCurrentRoute(); return; }
    if (action === 'open-diet') { openDietModal(button.dataset.kind); return; }
    if (action === 'open-beverage') { openBeverageModal(); return; }
    if (action === 'open-measurement') { openMeasurementModal(); return; }
    if (action === 'open-treatment') { openTreatmentModal(); return; }
    if (action === 'open-treatment-route') { state.treatmentFilters = { from: state.currentDate, to: state.currentDate, type: '', q: '' }; setRoute('treatment'); return; }
    if (action === 'use-preset') { const form = button.closest('form'); const input = form.querySelector('[name="quantityG"], [name="amountMl"]'); input.value = button.dataset.value; input.dispatchEvent(new Event('input', { bubbles: true })); return; }
    if (action === 'select-picker') { const form = button.closest('form'); $('[name="versionId"]', form).value = button.dataset.versionId; $('.picker-search', form).value = button.dataset.itemName; $('.picker-selected', form).textContent = `已选择：${button.dataset.itemName}`; $$('.picker-option', form).forEach((item) => item.classList.remove('selected')); button.classList.add('selected'); updateDietPreview(); return; }
    if (action === 'edit-diet') { const item = state.day.dietEntries.find((x) => x.id === button.dataset.id); openDietModal(button.dataset.kind, item); return; }
    if (action === 'delete-diet' && confirm('删除这条饮食记录？历史快照会保留在备份中。')) { await api(`/api/diet-entries/${button.dataset.id}`, { method: 'DELETE' }); showToast('饮食记录已删除'); await loadData(); await renderCurrentRoute(); return; }
    if (action === 'edit-beverage') { openBeverageModal(state.day.beverageEntries.find((x) => x.id === button.dataset.id)); return; }
    if (action === 'delete-beverage' && confirm('删除这条饮品记录？')) { await api(`/api/beverage-entries/${button.dataset.id}`, { method: 'DELETE' }); showToast('饮品记录已删除'); await loadData(); await renderCurrentRoute(); return; }
    if (action === 'edit-measurement') { openMeasurementModal(state.day.measurements.find((x) => x.id === button.dataset.id)); return; }
    if (action === 'delete-measurement' && confirm('删除这条血尿酸实测？')) { await api(`/api/measurements/${button.dataset.id}`, { method: 'DELETE' }); showToast('实测记录已删除'); await loadData(); await renderCurrentRoute(); return; }
    if (action === 'edit-treatment') { const item = findTreatmentEvent(button.dataset.id); if (item) openTreatmentModal(item); return; }
    if (action === 'delete-treatment' && confirm('删除这条治疗记录？')) { await api('/api/treatment-events/' + button.dataset.id, { method: 'DELETE' }); showToast('治疗记录已删除'); await loadData(); await renderCurrentRoute(); return; }
    if (action === 'add-treatment-result') { addTreatmentResultRow(); return; }
    if (action === 'remove-treatment-result') { button.closest('[data-treatment-result-row]')?.remove(); return; }
    if (action === 'clear-treatment-filters') { state.treatmentFilters = { from: '', to: '', type: '', q: '' }; await renderCurrentRoute(); return; }
    if (action === 'stats-period') { state.statsPeriod = button.dataset.period; await renderCurrentRoute(); return; }
    if (action === 'open-history-day') { state.currentDate = button.dataset.date; setRoute('today'); return; }
    if (action === 'manage-tab') { state.manageTab = button.dataset.tab; renderCurrentRoute(); return; }
    if (action === 'manage-group-filter') { state.manageGroupFilters[button.dataset.kind] = button.dataset.groupId || ''; await renderCurrentRoute(); return; }
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
    if (action === 'delete-group' && confirm('删除分组？内容会移动到未分组。')) { await api(`/api/groups/${button.dataset.kind}/${button.dataset.id}`, { method: 'DELETE' }); if (state.manageGroupFilters[button.dataset.kind] === button.dataset.id) state.manageGroupFilters[button.dataset.kind] = ''; showToast('分组已删除'); await loadData(); renderCurrentRoute(); return; }
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
  if (event.target.matches('[data-library-group-filter]')) { state.manageGroupFilters[event.target.dataset.libraryGroupFilter] = event.target.value; await renderCurrentRoute(); }
  if (event.target.matches('[name="mode"]')) toggleRecipeMode();
  if (event.target.matches('[data-form="treatment"] [name="eventType"]')) toggleTreatmentSections(event.target.closest('[data-form="treatment"]'));
  if (event.target.id === 'restore-file') {
    const file = event.target.files?.[0]; if (!file) return;
    const status = $('#backup-status');
    try {
      if (status) status.textContent = '正在校验恢复文件…';
      const payload = JSON.parse(await file.text());
      const preview = await api('/api/backup/restore/preview', { method: 'POST', body: JSON.stringify(payload) });
      if (status) status.textContent = `完整性已校验：SHA-256 ${preview.integrity.sha256.slice(0, 16)}…`;
      if (confirm(`文件完整性校验通过。将完整替换为 ${preview.dateRange ? `${preview.dateRange.from} 至 ${preview.dateRange.to}` : '无日期'} 的数据，并让所有设备重新验证。继续？`)) {
        payload.confirmation = 'RESTORE_URIC_ACID';
        await api('/api/backup/restore', { method: 'POST', body: JSON.stringify(payload) });
        showGate('恢复完成且完整性已校验。为安全起见，请重新输入共享访问口令。');
      }
    } catch (error) {
      if (status) status.textContent = `恢复文件不可用：${error.message}`;
      showToast(error.message, 'error');
    } finally {
      event.target.value = '';
    }
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target; if (!form.matches('form[data-form]')) return; event.preventDefault();
  if (form.dataset.pending === 'true') return;
  form.querySelector('.form-error')?.remove();
  setFormPending(form, true);
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.form === 'treatment-filter') {
      state.treatmentFilters = { from: data.from || '', to: data.to || '', type: data.type || '', q: data.q || '' };
      await renderCurrentRoute();
      return;
    }
    if (form.dataset.form === 'diet') {
      const body = { clientId: form.dataset.id ? undefined : form.dataset.clientId, date: data.date, kind: form.dataset.kind, versionId: data.versionId, quantityG: Number(data.quantityG) };
      const url = form.dataset.id ? `/api/diet-entries/${form.dataset.id}` : '/api/diet-entries'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast(form.dataset.id ? '饮食记录已更新' : '饮食记录已保存'); await loadData(); await renderCurrentRoute(); return;
    }
    if (form.dataset.form === 'beverage') { const body = { clientId: form.dataset.id ? undefined : form.dataset.clientId, date: data.date, beverageId: data.beverageId, amountMl: Number(data.amountMl), quantity: Number(data.quantity) }; const url = form.dataset.id ? `/api/beverage-entries/${form.dataset.id}` : '/api/beverage-entries'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast(form.dataset.id ? '饮品记录已更新' : '饮品记录已保存'); await loadData(); await renderCurrentRoute(); return; }
    if (form.dataset.form === 'measurement') { const body = { clientId: form.dataset.id ? undefined : form.dataset.clientId, date: data.date, time: data.time || null, valueOriginal: Number(data.valueOriginal), unitOriginal: data.unitOriginal, fasting: data.fasting, sourceKind: data.sourceKind, facility: data.facility, acuteFlare: data.acuteFlare === '' ? null : data.acuteFlare === 'true', referenceLowOriginal: data.referenceLowOriginal, referenceHighOriginal: data.referenceHighOriginal, referenceUnitOriginal: data.referenceUnitOriginal, note: data.note }; const url = form.dataset.id ? `/api/measurements/${form.dataset.id}` : '/api/measurements'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast(form.dataset.id ? '实测已更新' : '实测已保存'); await loadData(); await renderCurrentRoute(); return; }
    if (form.dataset.form === 'library-food') { const body = { ...data, basisG: Number(data.basisG), purineLow: data.purineLow === '' ? null : Number(data.purineLow), purineMean: data.purineMean === '' ? null : Number(data.purineMean), purineHigh: data.purineHigh === '' ? null : Number(data.purineHigh) }; const url = form.dataset.id ? `/api/foods/${form.dataset.id}` : '/api/foods'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast('食物资料已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'library-beverage') { const body = { ...data, isPlainWater: form.querySelector('[name="isPlainWater"]').checked, containsSugar: form.querySelector('[name="containsSugar"]').checked }; const url = form.dataset.id ? `/api/beverages/${form.dataset.id}` : '/api/beverages'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast('饮品资料已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'library-recipe') { const ingredients = $$('.ingredient-row', form).map((row) => ({ foodVersionId: $('[name="foodVersionId"]', row).value, grams: Number($('[name="grams"]', row).value) })).filter((row) => row.foodVersionId); const body = { name: data.name, groupId: data.groupId, mode: data.mode, finalYieldG: data.finalYieldG ? Number(data.finalYieldG) : null, purineLow: data.purineLow ? Number(data.purineLow) : null, purineHigh: data.purineHigh ? Number(data.purineHigh) : null, notes: data.notes, ingredients }; const url = form.dataset.id ? `/api/recipes/${form.dataset.id}` : '/api/recipes'; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast('菜谱资料已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'group') { const kind = form.dataset.kind; const body = { name: data.name }; const url = form.dataset.id ? `/api/groups/${kind}/${form.dataset.id}` : `/api/groups/${data.kind || kind}`; await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) }); closeModal(); showToast('分组已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'treatment') {
      const eventDate = data.eventDate;
      const eventType = data.eventType;
      const isFuture = eventDate > todayIso();
      if (isFuture && eventType !== 'follow_up' && !confirm('这是未来日期的治疗记录，确定仍要保存吗？')) return;
      const body = {
        clientId: form.dataset.id ? undefined : form.dataset.clientId,
        ...data,
        allowFuture: isFuture && eventType !== 'follow_up',
        results: eventType === 'hospital_check' ? collectTreatmentResults(form) : [],
        severity: data.severity === '' || data.severity === undefined ? null : Number(data.severity),
      };
      const url = form.dataset.id ? '/api/treatment-events/' + form.dataset.id : '/api/treatment-events';
      await api(url, { method: form.dataset.id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal();
      showToast(form.dataset.id ? '治疗记录已更新' : '治疗记录已保存');
      await loadData();
      await renderCurrentRoute();
      return;
    }
    if (form.dataset.form === 'source') { await api('/api/sources', { method: 'POST', body: JSON.stringify(data) }); closeModal(); showToast('来源已登记'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'settings') { await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultUrateUnit: data.defaultUrateUnit, waterGoalMl: data.waterGoalMl }) }); showToast('设置已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'portions') { const portions = $$('.portion-input', form).map((input) => ({ kind: input.dataset.kind, value: Number(input.value) })); await api('/api/portions', { method: 'PUT', body: JSON.stringify({ portions }) }); showToast('快捷份量模板已保存'); await loadData(); renderCurrentRoute(); return; }
    if (form.dataset.form === 'password') { if (data.newPassword !== data.confirmPassword) throw new Error('两次新口令不一致'); await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ newPassword: data.newPassword }) }); showGate('共享访问口令已修改，所有设备需要重新验证'); return; }
  } catch (error) {
    showToast(error.message, 'error');
    if (document.contains(form)) showFormError(form, error.message);
  } finally {
    if (document.contains(form)) setFormPending(form, false);
  }
});

$$('[data-route]').forEach((button) => button.addEventListener('click', () => setRoute(button.dataset.route)));
window.addEventListener('hashchange', () => { const route = routeFromHash(); if (route !== state.route) setRoute(route); });
$('#refresh-button').addEventListener('click', async () => { await loadData(); await renderCurrentRoute(); showToast('已刷新'); });
$('#mobile-menu').addEventListener('click', toggleMobileMenu);
$('#mobile-menu-backdrop').addEventListener('click', closeMobileMenu);
document.addEventListener('keydown', (event) => {
  const modal = $('.modal');
  if (event.key === 'Tab' && modal) {
    const focusable = getFocusable(modal);
    if (!focusable.length) { event.preventDefault(); modal.focus(); return; }
    const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    return;
  }
  const sidebar = $('.sidebar.open');
  if (event.key === 'Tab' && sidebar) {
    const focusable = getFocusable(sidebar);
    const first = focusable[0]; const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    return;
  }
  if (event.key !== 'Escape') return;
  if (modal) closeModal(); else closeMobileMenu();
});
$('#logout-button').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch {} showGate('已退出当前设备'); });
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $('#login-password'); const message = $('#login-message'); const button = $('#login-form button[type="submit"]');
  if (button.disabled) return;
  button.disabled = true; button.textContent = '正在验证…'; input.setAttribute('aria-invalid', 'false'); message.textContent = '正在验证设备…';
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: input.value }) });
    state.csrf = result.csrfToken; input.value = ''; message.textContent = ''; $('#gate').classList.add('hidden'); $('#app').classList.remove('hidden'); await loadData(); setRoute('today');
  } catch (error) {
    message.textContent = `${error.message}。请确认口令后重试。`; input.setAttribute('aria-invalid', 'true'); input.select();
  } finally {
    button.disabled = false; button.textContent = '进入记录';
  }
});

function addDays(date, days) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + Number(days)); return value.toISOString().slice(0, 10); }

boot();

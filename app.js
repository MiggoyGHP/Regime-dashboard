// ==========================================
// REGIME PERFORMANCE DASHBOARD
// Application Logic
// ==========================================

// --- State ---
let DATA = null;
let OHLC = null;
let currentRegime = 8;
let currentView = 'overview';
let currentColorFilter = 'all';
let selectedTradeIdx = null;
let navList = null; // Array of tradeId values for arrow key navigation
let equityChart, equityLineSeries, equityBandSeries = {};
let drawdownBandSeries = {};
let equityColorState = {};
let overlayState = { equity: true, spx: false, vix: false, mmth: false };
let overlaySeries = {};
let drawdownChart, drawdownSeries;
let tradeChart, tradeSeries, macdChart;
let tradeRegimeBandSeries = {};
let tradeRegimeState = {};
let tradeEmaSeries = {};
let macdLineSeries, macdSignalSeries, macdHistSeries;
let indicatorState = { ema10: false, ema20: false, ema25: false, ema50: false, ema200: false, macd: false };
let pnlDisplayMode = 'avg';
let sortField = 'pnl', sortDir = -1;
let searchTerm = '';
let selectedColors = null;
let selectedExitColors = null;
let selectedTypes = null;
let selectedStrategies = null;
let selectedTradeTypes = null;
let dateFrom = '';
let dateTo = '';
let currentPage = 1;
const PAGE_SIZE = 20;
const CANDLES_BEFORE = 120;
const CANDLES_AFTER = 40;

// --- Config ---
const EMA_CONFIG = {
  ema10:  { period: 10,  color: '#f0cc90', label: '10 EMA' },
  ema20:  { period: 20,  color: '#e5bb76', label: '20 EMA' },
  ema25:  { period: 25,  color: '#cfa45d', label: '25 EMA' },
  ema50:  { period: 50,  color: '#a37f3f', label: '50 EMA' },
  ema200: { period: 200, color: '#7a5f2e', label: '200 EMA' },
};

const OVERLAY_CONFIG = {
  spx:  { color: '#7fb3d9', lineWidth: 1.5, priceScaleId: 'spx',  label: 'SPX'  },
  vix:  { color: '#ff9a7a', lineWidth: 1.5, priceScaleId: 'vix',  label: 'VIX'  },
  mmth: { color: '#c9a4e0', lineWidth: 1.5, priceScaleId: 'mmth', label: 'MMTH' },
};

const CHART_OPTS = {
  layout: {
    background: { color: 'rgba(0, 0, 0, 0)' },
    textColor: 'rgba(255, 255, 255, 0.6)',
    fontFamily: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
  },
  grid: {
    vertLines: { color: 'rgba(229, 187, 118, 0.06)' },
    horzLines: { color: 'rgba(229, 187, 118, 0.06)' },
  },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  rightPriceScale: { borderColor: 'rgba(229, 187, 118, 0.2)' },
  timeScale: { borderColor: 'rgba(229, 187, 118, 0.2)', timeVisible: false },
  handleScroll: { vertTouchDrag: false },
};

// --- Constants ---
const STRATEGY_VALUES = [
  'Bluesky', 'Capitulation', 'Coil', 'IPO', 'Intraday Price Action',
  'Momentum', 'Others', 'Pullback', 'Range', 'Reset', 'Reversal'
];
const TRADE_TYPE_VALUES = ['Trade A', 'Trade B', 'Trade E'];

const STRATEGY_CLASS_MAP = {
  'Bluesky': 'strat-Bluesky', 'Capitulation': 'strat-Capitulation',
  'Coil': 'strat-Coil', 'IPO': 'strat-IPO',
  'Intraday Price Action': 'strat-Intraday', 'Momentum': 'strat-Momentum',
  'Others': 'strat-Others', 'Pullback': 'strat-Pullback',
  'Range': 'strat-Range', 'Reset': 'strat-Reset', 'Reversal': 'strat-Reversal',
};

// --- Regime Color Registry (GHP Overlay — 3-color palette) ---
const REGIME_COLOR_CONFIG = [
  { key: 'Green',  cls: 'green-card',  panelCls: 'panel-green',  hex: '#30d158', dotCss: 'var(--green)',          bandRgba: 'rgba(48,209,88,0.16)',    label: 'Green' },
  { key: 'Yellow', cls: 'yellow-card', panelCls: 'panel-yellow', hex: '#ffd60a', dotCss: 'var(--primary)',        bandRgba: 'rgba(255,214,10,0.22)',   label: 'Yellow' },
  { key: 'Red',    cls: 'red-card',    panelCls: 'panel-red',    hex: '#ff453a', dotCss: 'var(--red)',            bandRgba: 'rgba(255,69,58,0.16)',    label: 'Red' },
];

const ALL_BAND_COLORS = ['Green', 'Yellow', 'Red'];
const ALL_BAND_CONFIG = {};
for (const c of REGIME_COLOR_CONFIG) {
  ALL_BAND_CONFIG[c.key] = { top: c.bandRgba, bottom: c.bandRgba };
}

function getRegimeColorConfig() {
  return REGIME_COLOR_CONFIG;
}
function getRegimeColorKeys() {
  return REGIME_COLOR_CONFIG.map(c => c.key);
}
function getColorEntry(colorKey) {
  return REGIME_COLOR_CONFIG.find(c => c.key === colorKey) || { key: colorKey, cls: 'unknown-card', panelCls: '', hex: '#7a8290', dotCss: 'var(--unknown)', bandRgba: 'rgba(255,255,255,0.06)', label: colorKey };
}

const LEGACY_COLOR_MAP = { 'Yellow-Green': 'Yellow', 'Yellow-Red': 'Yellow', 'Blue': 'Yellow' };
function normalizeColor(c) { return LEGACY_COLOR_MAP[c] || c; }
function normalizeDataColors(data) {
  if (!data) return;
  if (data.regimeTrades) {
    for (const rk of Object.keys(data.regimeTrades)) {
      for (const t of data.regimeTrades[rk]) {
        if (t.regimeColor) t.regimeColor = normalizeColor(t.regimeColor);
        if (t.exitRegimeColor) t.exitRegimeColor = normalizeColor(t.exitRegimeColor);
      }
    }
  }
  if (data.regimePeriods) {
    for (const rk of Object.keys(data.regimePeriods)) {
      for (const p of data.regimePeriods[rk]) {
        if (p.color) p.color = normalizeColor(p.color);
      }
    }
  }
}

// --- Helpers ---
function strategyClass(s) { return s ? (STRATEGY_CLASS_MAP[s] || 'strat-Others') : ''; }
function tradeTypeClass(tt) { return tt ? 'tt-' + tt.replace(/\s+/g, '') : ''; }
function strategyLabel(s) { return s === 'Intraday Price Action' ? 'Intraday' : (s || ''); }

// --- Stats Computation ---
function computeTradeTypeStats(trades) {
  const result = {};
  TRADE_TYPE_VALUES.forEach(tt => {
    const subset = trades.filter(t => t.tradeType === tt);
    const n = subset.length;
    const totalPnL = subset.reduce((s, t) => s + t.pnl, 0);
    const wins = subset.filter(t => t.pnl > 0);
    const losses = subset.filter(t => t.pnl <= 0);
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
    const edgeRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
    let holdDays = [];
    subset.forEach(t => {
      if (t.entryDate && t.exitDate) {
        const d = (new Date(t.exitDate) - new Date(t.entryDate)) / 86400000;
        if (!isNaN(d)) holdDays.push(d);
      }
    });
    const avgHold = holdDays.length ? Math.round((holdDays.reduce((s, d) => s + d, 0) / holdDays.length) * 10) / 10 : 0;
    result[tt] = { count: n, totalPnL, winRate: n > 0 ? wins.length / n : 0, edgeRatio, avgHold };
  });
  return result;
}

function computeStrategyExpectancy(trades, regimeColor) {
  const filtered = trades.filter(t => t.regimeColor === regimeColor);
  const stratMap = {};
  STRATEGY_VALUES.forEach(s => { stratMap[s] = []; });
  filtered.forEach(t => {
    if (t.primaryStrategy && stratMap[t.primaryStrategy] !== undefined)
      stratMap[t.primaryStrategy].push(t);
  });
  const results = STRATEGY_VALUES.map(s => {
    const bucket = stratMap[s];
    const n = bucket.length;
    const totalPnL = bucket.reduce((a, t) => a + t.pnl, 0);
    const rBucket = bucket.filter(t => t.rMultiple != null);
    const rCount = rBucket.length;
    const rExpectancy = rCount > 0 ? rBucket.reduce((a, t) => a + t.rMultiple, 0) / rCount : 0;
    return {
      strategy: s,
      count: n,
      expectancy: n > 0 ? totalPnL / n : 0,
      totalPnL,
      rCount,
      rExpectancy,
      lowSample: n > 0 && n < 30,
    };
  });
  const valFn = pnlDisplayMode === 'total' ? d => d.totalPnL
              : pnlDisplayMode === 'rexp'  ? d => d.rExpectancy
              : d => d.expectancy;
  results.sort((a, b) => {
    const aEmpty = pnlDisplayMode === 'rexp' ? a.rCount === 0 : a.count === 0;
    const bEmpty = pnlDisplayMode === 'rexp' ? b.rCount === 0 : b.count === 0;
    if (aEmpty && !bEmpty) return -1;
    if (!aEmpty && bEmpty) return 1;
    if (aEmpty && bEmpty) return a.strategy.localeCompare(b.strategy);
    return valFn(b) - valFn(a);
  });
  return results;
}

// --- Heatmap Computation ---
let heatmapSortCol = 'Total';
let heatmapSortDir = -1;

function _bucketStats(subset) {
  const n = subset.length;
  const totalPnL = subset.reduce((sum, t) => sum + t.pnl, 0);
  const wins = subset.filter(t => t.pnl > 0);
  const losses = subset.filter(t => t.pnl <= 0);
  const avgWin = wins.length ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
  const rBucket = subset.filter(t => t.rMultiple != null);
  const rCount = rBucket.length;
  const rExpectancy = rCount ? rBucket.reduce((s, t) => s + t.rMultiple, 0) / rCount : 0;
  return {
    count: n,
    totalPnL,
    avgPnL: n > 0 ? totalPnL / n : 0,
    winRate: n > 0 ? wins.length / n : 0,
    edgeRatio: avgLoss > 0 ? avgWin / avgLoss : 0,
    rCount,
    rExpectancy,
  };
}

function computeHeatmapData(trades) {
  const colors = getRegimeColorKeys();
  const matrix = {};
  STRATEGY_VALUES.forEach(s => {
    matrix[s] = {};
    colors.forEach(c => {
      matrix[s][c] = _bucketStats(trades.filter(t => t.primaryStrategy === s && t.regimeColor === c));
    });
    matrix[s].Total = _bucketStats(trades.filter(t => t.primaryStrategy === s));
  });
  return matrix;
}

function heatmapCellColor(val, count, mode) {
  if (count === 0) return 'transparent';
  let hi, lo;
  if (mode === 'total')      { hi = 10000; lo = 2000; }
  else if (mode === 'rexp')  { hi = 0.30;  lo = 0.10; }
  else                       { hi = 500;   lo = 100; }
  if (val > hi) return 'rgba(48,209,88,0.35)';
  if (val > lo) return 'rgba(48,209,88,0.18)';
  if (val > 0) return 'rgba(48,209,88,0.08)';
  if (val > -lo) return 'rgba(255,69,58,0.08)';
  if (val > -hi) return 'rgba(255,69,58,0.18)';
  return 'rgba(255,69,58,0.35)';
}

function fmtRExp(val) {
  return (val >= 0 ? '+' : '') + val.toFixed(2) + 'R';
}

function renderStrategyRegimeHeatmap() {
  const trades = getFilteredTrades();
  const matrix = computeHeatmapData(trades);
  const colorCfg = getRegimeColorConfig();
  const colors = colorCfg.map(c => c.key);

  const isTotal = pnlDisplayMode === 'total';
  const isRexp = pnlDisplayMode === 'rexp';
  const valKey = isRexp ? 'rExpectancy' : isTotal ? 'totalPnL' : 'avgPnL';
  const countKey = isRexp ? 'rCount' : 'count';

  const sorted = [...STRATEGY_VALUES].sort((a, b) => {
    const aCell = matrix[a][heatmapSortCol];
    const bCell = matrix[b][heatmapSortCol];
    const aEmpty = aCell[countKey] === 0;
    const bEmpty = bCell[countKey] === 0;
    if (aEmpty && !bEmpty) return 1;
    if (!aEmpty && bEmpty) return -1;
    return (bCell[valKey] - aCell[valKey]) * heatmapSortDir;
  });

  const sortArrow = col => heatmapSortCol === col ? (heatmapSortDir === -1 ? ' \u25BC' : ' \u25B2') : '';
  const headerCells = colorCfg.map(c =>
    `<th class="heatmap-sort-header" data-sort-col="${c.key}" style="cursor:pointer;user-select:none;"><span class="color-dot" style="background:${c.dotCss};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle;"></span>${c.key}${sortArrow(c.key)}</th>`
  ).join('') + `<th class="heatmap-sort-header" data-sort-col="Total" style="cursor:pointer;user-select:none;">Total${sortArrow('Total')}</th>`;

  const renderCell = d => {
    if (d[countKey] === 0) {
      return isRexp && d.count > 0
        ? `<td class="heatmap-cell no-data"><div class="heatmap-avg" style="color:var(--text-muted)">\u2014</div><div class="heatmap-meta">no R data</div></td>`
        : `<td class="heatmap-cell no-data"><div class="heatmap-avg">\u2014</div></td>`;
    }
    const lowSample = d[countKey] < 5 ? ' low-sample' : '';
    const displayVal = d[valKey];
    const bg = heatmapCellColor(displayVal, d[countKey], pnlDisplayMode);
    const valClass = displayVal >= 0 ? 'positive' : 'negative';
    const valText = isRexp ? fmtRExp(displayVal) : fmtPnL(Math.round(displayVal));
    const metaText = isRexp
      ? `n=${d.rCount} \u00B7 ${Math.round(d.winRate * 100)}% WR`
      : `n=${d.count} \u00B7 ${Math.round(d.winRate * 100)}% WR`;
    return `<td class="heatmap-cell${lowSample}" style="background:${bg}">
      <div class="heatmap-avg ${valClass}">${valText}</div>
      <div class="heatmap-meta">${metaText}</div>
    </td>`;
  };

  const rows = sorted.map(s => {
    const cells = colors.map(c => renderCell(matrix[s][c])).join('');

    const t = matrix[s].Total;
    const totalEmpty = t[countKey] === 0;
    const totalDisplayVal = t[valKey];
    const totalValClass = totalDisplayVal >= 0 ? 'positive' : 'negative';
    const totalBg = heatmapCellColor(totalDisplayVal, t[countKey], pnlDisplayMode);
    const totalValText = isRexp ? fmtRExp(totalDisplayVal) : fmtPnL(Math.round(totalDisplayVal));
    let totalMeta;
    if (isRexp) totalMeta = `n=${t.rCount} \u00B7 ${Math.round(t.winRate * 100)}% WR`;
    else if (isTotal) totalMeta = `n=${t.count} \u00B7 ${Math.round(t.winRate * 100)}% WR`;
    else totalMeta = `n=${t.count} \u00B7 $${fmt(Math.abs(t.totalPnL), 0)}`;
    const totalCell = totalEmpty
      ? `<td class="heatmap-total-cell"><div class="heatmap-avg" style="color:var(--text-muted)">\u2014</div>${isRexp && t.count > 0 ? '<div class="heatmap-meta">no R data</div>' : ''}</td>`
      : `<td class="heatmap-total-cell" style="background:${totalBg}">
          <div class="heatmap-avg ${totalValClass}">${totalValText}</div>
          <div class="heatmap-meta">${totalMeta}</div>
        </td>`;

    return `<tr><td class="heatmap-strat-label">${strategyLabel(s)}</td>${cells}${totalCell}</tr>`;
  }).join('');

  const avgActive = pnlDisplayMode === 'avg' ? ' active' : '';
  const totalActive = pnlDisplayMode === 'total' ? ' active' : '';
  const rexpActive = pnlDisplayMode === 'rexp' ? ' active' : '';
  const modeLabel = isRexp ? 'Expectancy (R)' : isTotal ? 'Total P&L' : 'Avg P&L';

  document.getElementById('heatmap-section').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:10px;">
      <div class="indicator-toggles" style="margin-bottom:0;">
        <div class="indicator-toggle pnl-mode-toggle${avgActive}" data-pnl-mode="avg" style="color:#e5bb76;border-color:#e5bb76;background:rgba(229,187,118,0.12);">Avg P&L</div>
        <div class="indicator-toggle pnl-mode-toggle${totalActive}" data-pnl-mode="total" style="color:#e5bb76;border-color:#e5bb76;background:rgba(229,187,118,0.12);">Total P&L</div>
        <div class="indicator-toggle pnl-mode-toggle${rexpActive}" data-pnl-mode="rexp" style="color:#e5bb76;border-color:#e5bb76;background:rgba(229,187,118,0.12);">Expectancy</div>
      </div>
    </div>
    <div class="heatmap-subtitle">Showing ${modeLabel} \u00B7 Click column headers to sort \u00B7 Dimmed = &lt; 5 trades${isRexp ? ' \u00B7 Only trades with recorded risk counted' : ''}</div>
    <table class="heatmap-table">
      <thead><tr><th class="heatmap-strat-header">Strategy</th>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  document.querySelectorAll('.heatmap-sort-header').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sortCol;
      if (heatmapSortCol === col) heatmapSortDir *= -1;
      else { heatmapSortCol = col; heatmapSortDir = -1; }
      renderStrategyRegimeHeatmap();
    });
  });

  document.querySelectorAll('.pnl-mode-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      pnlDisplayMode = btn.dataset.pnlMode;
      renderStrategyPerformance();
      renderStrategyRegimeHeatmap();
    });
  });
}

// --- Tag Override System ---
function getTagOverrides() {
  try { return JSON.parse(localStorage.getItem('tagOverrides') || '{}'); }
  catch { return {}; }
}
function saveTagOverride(tradeId, field, value) {
  const ov = getTagOverrides();
  if (!ov[tradeId]) ov[tradeId] = {};
  ov[tradeId][field] = value;
  localStorage.setItem('tagOverrides', JSON.stringify(ov));
}
function applyTagOverrides() {
  const ov = getTagOverrides();
  if (!Object.keys(ov).length) return;
  for (const rk in DATA.regimeTrades) {
    for (const t of DATA.regimeTrades[rk]) {
      const o = ov[t.tradeId];
      if (o) {
        if (o.primaryStrategy !== undefined) t.primaryStrategy = o.primaryStrategy;
        if (o.tradeType !== undefined) t.tradeType = o.tradeType;
      }
    }
  }
}

// --- Tag Dropdown Editor ---
let activeDropdown = null;
function closeDropdown() { if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; } }
document.addEventListener('click', () => closeDropdown());
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDropdown(); });

function showTagDropdown(event, tradeId, field, currentValue) {
  event.stopPropagation();
  closeDropdown();
  const values = field === 'primaryStrategy' ? STRATEGY_VALUES : TRADE_TYPE_VALUES;
  const rect = event.target.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'tag-dropdown';
  dd.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  dd.style.left = rect.left + 'px';
  dd.onclick = e => e.stopPropagation();

  const clear = document.createElement('div');
  clear.className = 'tag-dropdown-item' + (!currentValue ? ' selected' : '');
  clear.textContent = '(none)';
  clear.onclick = () => applyTagEdit(tradeId, field, '');
  dd.appendChild(clear);

  values.forEach(v => {
    const item = document.createElement('div');
    item.className = 'tag-dropdown-item' + (v === currentValue ? ' selected' : '');
    item.textContent = field === 'primaryStrategy' ? strategyLabel(v) : v;
    item.onclick = () => applyTagEdit(tradeId, field, v);
    dd.appendChild(item);
  });

  document.body.appendChild(dd);
  activeDropdown = dd;
  const ddr = dd.getBoundingClientRect();
  if (ddr.right > window.innerWidth) dd.style.left = (window.innerWidth - ddr.width - 8) + 'px';
  if (ddr.bottom > window.innerHeight) dd.style.top = (rect.top + window.scrollY - ddr.height - 4) + 'px';
}

function applyTagEdit(tradeId, field, value) {
  closeDropdown();
  for (const rk in DATA.regimeTrades) {
    const t = DATA.regimeTrades[rk].find(t => t.tradeId === tradeId);
    if (t) t[field] = value;
  }
  saveTagOverride(tradeId, field, value);
  renderRegimeColorCards();
  renderStrategyPerformance();
  renderStrategyRegimeHeatmap();
  renderTable();
  if (selectedTradeIdx === tradeId) showTradeDetail(tradeId);
}

// --- Sizing Lab state ---
let SIZING_RUNS = null;            // { runs: [...] } loaded from sizing_runs.json
let sizingActiveRunId = null;
let sizingStrategySort = { field: 'expectancy_R', dir: -1 };
let sizingHistorySort = 'expectancy_R';
let sizingHistoryDedupe = true;
let sizingHeatmapMetric = 'expectancy_R';

// --- Trade Replay state ---
let REPLAY_TRADES = null;          // filterable list of replayable trades
let REPLAY_FILTERED = null;        // currently visible (after filters)
let replayIndex = 0;
let replayChartOrig = null;
let replayChartVar = null;
let replayBestRun = null;          // cached best 2D run
let replaySimCache = new Map();    // key=tradeId|s|c -> simResult

// --- Data Loading ---
const _cb = '?v=' + Date.now();
Promise.all([
  fetch('data.json' + _cb).then(r => { if (!r.ok) throw new Error('Failed to load data.json'); return r.json(); }),
  fetch('ohlc.json' + _cb).then(r => { if (!r.ok) throw new Error('Failed to load ohlc.json'); return r.json(); }),
  // sizing_runs.json is optional — missing file is fine (empty state shown)
  fetch('sizing_runs.json' + _cb).then(r => r.ok ? r.json() : { runs: [] }).catch(() => ({ runs: [] })),
]).then(([d, o, s]) => { DATA = d; OHLC = o; SIZING_RUNS = s || { runs: [] }; normalizeDataColors(DATA); applyTagOverrides(); init(); })
.catch(e => {
  document.querySelector('.content').innerHTML = `
    <div style="padding:60px 32px;text-align:center;">
      <div style="font-size:16px;font-weight:600;color:var(--red);margin-bottom:8px;">Error loading dashboard data</div>
      <div style="font-size:13px;color:var(--text-dim);">${e.message}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:12px;">Check that data.json and ohlc.json exist and try refreshing the page.</div>
    </div>`;
});

// --- Init ---
function init() {
  selectedColors = new Set(getRegimeColorKeys());
  selectedExitColors = new Set(getRegimeColorKeys());
  selectedTypes = new Set(['Stocks', 'Equity and Index Options']);
  selectedStrategies = new Set([...STRATEGY_VALUES, '(Untagged)']);
  selectedTradeTypes = new Set([...TRADE_TYPE_VALUES, '(Untagged)']);
  setupViewTabs();
  setupColorFilter();
  setupIndicatorToggles();
  setupEquityToggles();
  setupOverlayToggles();
  setupTradeRegimeToggles();
  createEquityChart();
  createDrawdownChart();
  syncEquityDrawdown();
  setupTableControls();
  setupKeyboardShortcuts();
  setupTradeDetailPanel();
  setupSizingLab();
  setupTradeReplay();
  render();
}

// --- View Management ---
function setupViewTabs() {
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchView(tab.dataset.view);
    });
  });
}

function switchView(view) {
  if (view === currentView) return;
  currentView = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));

  // Resize charts when switching to overview (they may have been in hidden state)
  if (view === 'overview') {
    setTimeout(() => {
      if (equityChart) equityChart.applyOptions({ width: document.getElementById('equity-chart').clientWidth });
      if (drawdownChart) drawdownChart.applyOptions({ width: document.getElementById('drawdown-chart').clientWidth });
    }, 20);
  }
  if (view === 'sizing') {
    renderSizingLab();
  }
  if (view === 'replay') {
    setTimeout(() => renderTradeReplay(), 30);
  }
}

// --- Color Filter (Performers) ---
function setupColorFilter() {
  const container = document.getElementById('color-filter');
  container.innerHTML = '';
  const colorCfg = getRegimeColorConfig();
  const entries = [{ key: 'all', label: 'All', hex: null }, ...colorCfg.map(c => ({ key: c.key, label: c.label, hex: c.hex }))];
  entries.forEach(e => {
    const btn = document.createElement('button');
    btn.className = 'color-tab' + (e.key === 'all' ? ' active' : '');
    if (e.hex) {
      btn.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${e.hex};margin-right:4px;vertical-align:middle;"></span>${e.label}`;
    } else {
      btn.textContent = e.label;
    }
    btn.addEventListener('click', () => {
      container.querySelectorAll('.color-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentColorFilter = e.key;
      renderPerformers();
    });
    container.appendChild(btn);
  });
}

// --- Toggle Setup ---
function setupIndicatorToggles() {
  document.querySelectorAll('.indicator-toggle[data-indicator]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ind = btn.dataset.indicator;
      indicatorState[ind] = !indicatorState[ind];
      btn.classList.toggle('active', indicatorState[ind]);
      applyIndicatorVisibility();
    });
  });
}

function setupEquityToggles() {
  const container = document.getElementById('equity-color-toggles');
  container.innerHTML = '';
  const colorCfg = getRegimeColorConfig();
  equityColorState = {};
  colorCfg.forEach(c => {
    equityColorState[c.key] = true;
    const btn = document.createElement('div');
    btn.className = 'indicator-toggle active';
    btn.dataset.eqColor = c.key;
    btn.style.cssText = `color:${c.hex}; border-color:${c.hex}; background:${c.bandRgba.replace('0.18', '0.1')};`;
    btn.textContent = c.label;
    btn.addEventListener('click', () => {
      equityColorState[c.key] = !equityColorState[c.key];
      btn.classList.toggle('active', equityColorState[c.key]);
      applyEquityVisibility();
    });
    container.appendChild(btn);
  });
}

function applyEquityVisibility() {
  for (const [color, series] of Object.entries(equityBandSeries)) {
    if (series) series.applyOptions({ visible: !!equityColorState[color] });
  }
  for (const [color, series] of Object.entries(drawdownBandSeries)) {
    if (series) series.applyOptions({ visible: !!equityColorState[color] });
  }
}

function setupOverlayToggles() {
  document.querySelectorAll('.indicator-toggle[data-overlay]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.overlay;
      overlayState[key] = !overlayState[key];
      btn.classList.toggle('active', overlayState[key]);
      applyOverlayVisibility();
    });
  });
}

function applyOverlayVisibility() {
  if (equityLineSeries) equityLineSeries.applyOptions({ visible: overlayState.equity });
  for (const [key, series] of Object.entries(overlaySeries)) {
    if (series) series.applyOptions({ visible: overlayState[key] });
  }
}

function setupTradeRegimeToggles() {
  const container = document.getElementById('trade-regime-toggles');
  container.innerHTML = '';
  const colorCfg = getRegimeColorConfig();
  tradeRegimeState = {};
  colorCfg.forEach(c => {
    tradeRegimeState[c.key] = false;
    const btn = document.createElement('div');
    btn.className = 'indicator-toggle';
    btn.dataset.tradeRegime = c.key;
    btn.style.cssText = `color:${c.hex}; border-color:${c.hex}; background:${c.bandRgba.replace('0.18', '0.1')};`;
    btn.textContent = c.label;
    btn.addEventListener('click', () => {
      tradeRegimeState[c.key] = !tradeRegimeState[c.key];
      btn.classList.toggle('active', tradeRegimeState[c.key]);
      applyTradeRegimeVisibility();
    });
    container.appendChild(btn);
  });
}

function applyTradeRegimeVisibility() {
  for (const [color, series] of Object.entries(tradeRegimeBandSeries)) {
    if (series) series.applyOptions({ visible: tradeRegimeState[color] });
  }
}

function applyIndicatorVisibility() {
  for (const [key, series] of Object.entries(tradeEmaSeries)) {
    if (series) series.applyOptions({ visible: indicatorState[key] });
  }
  const macdContainer = document.getElementById('macd-chart');
  if (indicatorState.macd) {
    macdContainer.style.display = 'block';
    if (macdChart) macdChart.applyOptions({ width: macdContainer.clientWidth });
    if (macdLineSeries) macdLineSeries.applyOptions({ visible: true });
    if (macdSignalSeries) macdSignalSeries.applyOptions({ visible: true });
    if (macdHistSeries) macdHistSeries.applyOptions({ visible: true });
  } else {
    macdContainer.style.display = 'none';
  }
}

// --- Multi-Select ---
function setupMultiSelect(containerId, values, labelFn, currentSet, onChange, allLabel, pluralLabel) {
  const btn = document.getElementById(containerId + '-btn');
  const panel = document.getElementById(containerId + '-panel');

  let html = `<label class="select-all"><input type="checkbox" data-select-all checked> Select All</label>`;
  values.forEach(v => {
    html += `<label><input type="checkbox" value="${v}" checked> ${labelFn(v)}</label>`;
  });
  panel.innerHTML = html;

  const selectAllCb = panel.querySelector('[data-select-all]');
  const itemCbs = panel.querySelectorAll('input[type="checkbox"]:not([data-select-all])');

  function updateBtn() {
    const total = values.length;
    const checked = currentSet.size;
    if (checked === total) {
      btn.textContent = allLabel;
      btn.classList.remove('filtered');
    } else {
      btn.textContent = `${checked} of ${total} ${pluralLabel}`;
      btn.classList.add('filtered');
    }
  }

  itemCbs.forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) currentSet.add(cb.value);
      else currentSet.delete(cb.value);
      selectAllCb.checked = currentSet.size === values.length;
      selectAllCb.indeterminate = currentSet.size > 0 && currentSet.size < values.length;
      updateBtn();
      onChange(currentSet);
    });
  });

  selectAllCb.addEventListener('change', () => {
    itemCbs.forEach(cb => {
      cb.checked = selectAllCb.checked;
      if (selectAllCb.checked) currentSet.add(cb.value);
      else currentSet.delete(cb.value);
    });
    selectAllCb.indeterminate = false;
    updateBtn();
    onChange(currentSet);
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = panel.style.display !== 'none';
    document.querySelectorAll('.multi-select-panel').forEach(p => { p.style.display = 'none'; });
    document.querySelectorAll('.multi-select-btn').forEach(b => b.classList.remove('open'));
    if (!isOpen) {
      panel.style.display = 'block';
      btn.classList.add('open');
    }
  });

  panel.addEventListener('click', e => e.stopPropagation());
}

// Close multi-select panels on outside click
document.addEventListener('click', () => {
  document.querySelectorAll('.multi-select-panel').forEach(p => { p.style.display = 'none'; });
  document.querySelectorAll('.multi-select-btn').forEach(b => b.classList.remove('open'));
});

function rebuildColorMultiSelects() {
  setupMultiSelect('entry-color-multi', getRegimeColorKeys(),
    v => v, selectedColors, s => { selectedColors = s; currentPage = 1; render(); },
    'All Entry Colors', 'Entry Colors'
  );
  setupMultiSelect('exit-color-multi', getRegimeColorKeys(),
    v => v, selectedExitColors, s => { selectedExitColors = s; currentPage = 1; render(); },
    'All Exit Colors', 'Exit Colors'
  );
}

// --- Table Controls ---
function setupTableControls() {
  document.getElementById('search-input').addEventListener('input', e => {
    searchTerm = e.target.value.toLowerCase();
    currentPage = 1;
    renderTable();
  });
  setupMultiSelect('entry-color-multi', getRegimeColorKeys(),
    v => v, selectedColors, s => { selectedColors = s; currentPage = 1; render(); },
    'All Entry Colors', 'Entry Colors'
  );
  setupMultiSelect('exit-color-multi', getRegimeColorKeys(),
    v => v, selectedExitColors, s => { selectedExitColors = s; currentPage = 1; render(); },
    'All Exit Colors', 'Exit Colors'
  );
  setupMultiSelect('type-multi', ['Stocks', 'Equity and Index Options'],
    v => v === 'Equity and Index Options' ? 'Options' : v,
    selectedTypes, s => { selectedTypes = s; currentPage = 1; render(); },
    'All Types', 'Types'
  );
  setupMultiSelect('strategy-multi', [...STRATEGY_VALUES, '(Untagged)'],
    v => v === 'Intraday Price Action' ? 'Intraday' : v,
    selectedStrategies, s => { selectedStrategies = s; currentPage = 1; render(); },
    'All Strategies', 'Strategies'
  );
  setupMultiSelect('tradetype-multi', [...TRADE_TYPE_VALUES, '(Untagged)'],
    v => v.startsWith('Trade ') ? v.replace('Trade ', '') : v,
    selectedTradeTypes, s => { selectedTradeTypes = s; currentPage = 1; render(); },
    'All Trade Types', 'Trade Types'
  );

  // Date range filter
  const dateFromEl = document.getElementById('date-from');
  const dateToEl = document.getElementById('date-to');
  const dateClearEl = document.getElementById('date-clear');
  function updateDateFilter() {
    dateFrom = dateFromEl.value;
    dateTo = dateToEl.value;
    dateFromEl.classList.toggle('active', !!dateFrom);
    dateToEl.classList.toggle('active', !!dateTo);
    dateClearEl.style.display = (dateFrom || dateTo) ? 'flex' : 'none';
    currentPage = 1;
    render();
    if (dateFrom && dateTo) {
      try { equityChart.timeScale().setVisibleRange({ from: dateFrom, to: dateTo }); } catch(e) {}
    } else if (!dateFrom && !dateTo) {
      equityChart.timeScale().fitContent();
    }
  }
  dateFromEl.addEventListener('change', updateDateFilter);
  dateToEl.addEventListener('change', updateDateFilter);
  dateClearEl.addEventListener('click', () => {
    dateFromEl.value = '';
    dateToEl.value = '';
    updateDateFilter();
  });

  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortField === field) sortDir *= -1;
      else { sortField = field; sortDir = field === 'pnl' ? -1 : 1; }
      document.querySelectorAll('thead th').forEach(t => t.classList.remove('sorted'));
      th.classList.add('sorted');
      currentPage = 1;
      renderTable();
    });
  });
}

// --- Keyboard Shortcuts ---
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Don't trigger when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === '1' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); switchView('overview'); }
    else if (e.key === '2' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); switchView('analysis'); }
    else if (e.key === '3' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); switchView('trades'); }
    else if (e.key === 'Escape') closeTradeDetail();
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const overlay = document.getElementById('trade-detail-overlay');
      if (!overlay.classList.contains('open')) return;
      e.preventDefault();
      navigateTrade(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });
}

function navigateTrade(direction) {
  if (!navList || navList.length <= 1) return;
  const idx = navList.indexOf(selectedTradeIdx);
  if (idx === -1) return;
  let next = idx + direction;
  if (next < 0) next = navList.length - 1;
  if (next >= navList.length) next = 0;
  showTradeDetail(navList[next]);
}

// --- Trade Detail Panel ---
function setupTradeDetailPanel() {
  document.getElementById('panel-close').addEventListener('click', closeTradeDetail);
  document.getElementById('trade-detail-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeTradeDetail();
  });
  document.getElementById('panel-prev').addEventListener('click', () => navigateTrade(-1));
  document.getElementById('panel-next').addEventListener('click', () => navigateTrade(1));
}

function closeTradeDetail() {
  document.getElementById('trade-detail-overlay').classList.remove('open');
  document.body.style.overflow = '';
  selectedTradeIdx = null;
  navList = null;
}

// --- Rendering ---
function render() {
  const regimeKey = `regime${currentRegime}`;
  for (const t of getTrades()) {
    t.exitRegimeColor = getRegimeColorForDate(t.exitDate, regimeKey);
  }
  updateFilterBanner();
  renderStatBar();
  renderRegimeColorCards();
  renderStrategyPerformance();
  renderStrategyRegimeHeatmap();
  renderEquityChart();
  renderDrawdownChart();
  const eqRange = equityChart.timeScale().getVisibleRange();
  if (eqRange) {
    try { drawdownChart.timeScale().setVisibleRange(eqRange); } catch(e) {}
  }
  renderPerformers();
  renderTable();
  updateTradesTabBadge();
}

function getTrades() { return DATA.regimeTrades[`regime${currentRegime}`]; }
function getStats() { return DATA.regimeStats[`regime${currentRegime}`]; }

function allFiltersSelected() {
  const nColors = getRegimeColorKeys().length;
  return selectedColors.size === nColors &&
         selectedExitColors.size === nColors &&
         selectedTypes.size === 2 &&
         selectedStrategies.size === STRATEGY_VALUES.length + 1 &&
         selectedTradeTypes.size === TRADE_TYPE_VALUES.length + 1 &&
         !dateFrom && !dateTo;
}

function updateFilterBanner() {
  const banner = document.getElementById('filter-banner');
  if (allFiltersSelected()) {
    banner.style.display = 'none';
    return;
  }
  const parts = [];
  const nColors = getRegimeColorKeys().length;
  if (selectedColors.size < nColors) parts.push(`${selectedColors.size}/${nColors} entry colors`);
  if (selectedExitColors.size < nColors) parts.push(`${selectedExitColors.size}/${nColors} exit colors`);
  if (selectedTypes.size < 2) parts.push(`${selectedTypes.size}/2 types`);
  if (selectedStrategies.size < STRATEGY_VALUES.length + 1) parts.push(`${selectedStrategies.size}/${STRATEGY_VALUES.length + 1} strategies`);
  if (selectedTradeTypes.size < TRADE_TYPE_VALUES.length + 1) parts.push(`${selectedTradeTypes.size}/${TRADE_TYPE_VALUES.length + 1} trade types`);
  if (dateFrom || dateTo) parts.push(`date: ${dateFrom || '...'} to ${dateTo || '...'}`);
  banner.style.display = 'flex';
  banner.className = 'filter-banner';
  banner.innerHTML = `
    <div class="filter-banner-text">Filters active: ${parts.join(' \u00B7 ')}</div>
    <button class="filter-banner-clear" onclick="clearAllFilters()">Clear all filters</button>
  `;
}

function clearAllFilters() {
  selectedColors = new Set(getRegimeColorKeys());
  selectedExitColors = new Set(getRegimeColorKeys());
  selectedTypes = new Set(['Stocks', 'Equity and Index Options']);
  selectedStrategies = new Set([...STRATEGY_VALUES, '(Untagged)']);
  selectedTradeTypes = new Set([...TRADE_TYPE_VALUES, '(Untagged)']);
  dateFrom = '';
  dateTo = '';
  currentPage = 1;
  const fromInput = document.getElementById('date-from');
  const toInput = document.getElementById('date-to');
  if (fromInput) fromInput.value = '';
  if (toInput) toInput.value = '';
  document.querySelectorAll('.multi-select-panel input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  document.querySelectorAll('.multi-select-btn').forEach(btn => {
    btn.classList.remove('filtered');
    const id = btn.id;
    if (id === 'entry-color-multi-btn') btn.textContent = 'All Entry Colors';
    else if (id === 'exit-color-multi-btn') btn.textContent = 'All Exit Colors';
    else if (id === 'type-multi-btn') btn.textContent = 'All Types';
    else if (id === 'strategy-multi-btn') btn.textContent = 'All Strategies';
    else if (id === 'tradetype-multi-btn') btn.textContent = 'All Trade Types';
  });
  render();
}

function getFilteredTrades() {
  return getTrades().filter(t =>
    selectedColors.has(t.regimeColor) &&
    selectedExitColors.has(t.exitRegimeColor) &&
    selectedTypes.has(t.type) &&
    selectedStrategies.has(t.primaryStrategy || '(Untagged)') &&
    selectedTradeTypes.has(t.tradeType || '(Untagged)') &&
    (!dateFrom || t.entryDate >= dateFrom) &&
    (!dateTo || t.entryDate <= dateTo)
  );
}

function buildEquityCurve(trades) {
  const sorted = [...trades].sort((a, b) => a.exitDate.localeCompare(b.exitDate));
  const byDate = new Map();
  sorted.forEach(t => {
    byDate.set(t.exitDate, (byDate.get(t.exitDate) || 0) + t.pnl);
  });
  let cumPnL = 0, peak = 0;
  const result = [];
  for (const [date, dayPnL] of byDate) {
    cumPnL += dayPnL;
    peak = Math.max(peak, cumPnL);
    result.push({ date, cumPnL, drawdown: cumPnL - peak });
  }
  return result;
}

function computeRegimeStats(trades) {
  const n = trades.length;
  if (n === 0) return { '# Trades': 0, 'Total P&L': 0, 'Win Rate': 0, 'Avg P&L': 0, 'Edge Ratio': 0, 'Avg Holding Period': 0, 'Max Win': 0, 'Max Loss': 0, 'Expectancy': null, 'R Sample': 0, 'Avg Win R': 0, 'Avg Loss R': 0, 'R Win Rate': 0 };
  const pnls = trades.map(t => t.pnl);
  const totalPnL = pnls.reduce((s, p) => s + p, 0);
  const winners = trades.filter(t => t.pnl > 0);
  const losers = trades.filter(t => t.pnl <= 0);
  const avgWin = winners.length ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
  const avgLoss = losers.length ? Math.abs(losers.reduce((s, t) => s + t.pnl, 0) / losers.length) : 0;
  const edgeRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
  let holdDays = [], winHoldDays = [], lossHoldDays = [];
  trades.forEach(t => {
    if (t.entryDate && t.exitDate) {
      const d = (new Date(t.exitDate) - new Date(t.entryDate)) / 86400000;
      if (!isNaN(d)) {
        holdDays.push(d);
        if (t.pnl > 0) winHoldDays.push(d);
        else lossHoldDays.push(d);
      }
    }
  });
  const avgHold = holdDays.length ? holdDays.reduce((s, d) => s + d, 0) / holdDays.length : 0;
  const avgWinHold = winHoldDays.length ? winHoldDays.reduce((s, d) => s + d, 0) / winHoldDays.length : 0;
  const avgLossHold = lossHoldDays.length ? lossHoldDays.reduce((s, d) => s + d, 0) / lossHoldDays.length : 0;

  // Van Tharp expectancy (R-multiple based) over the R-enriched subset
  const rTrades = trades.filter(t => t.rMultiple != null);
  const rN = rTrades.length;
  const rWinners = rTrades.filter(t => t.rMultiple > 0);
  const rLosers = rTrades.filter(t => t.rMultiple <= 0);
  const avgWinR = rWinners.length ? rWinners.reduce((s, t) => s + t.rMultiple, 0) / rWinners.length : 0;
  const avgLossR = rLosers.length ? rLosers.reduce((s, t) => s + t.rMultiple, 0) / rLosers.length : 0;
  const expectancy = rN ? rTrades.reduce((s, t) => s + t.rMultiple, 0) / rN : null;
  const rWinRate = rN ? rWinners.length / rN : 0;

  return {
    '# Trades': n, 'Total P&L': totalPnL, 'Win Rate': n ? winners.length / n : 0,
    'Avg P&L': n ? totalPnL / n : 0, 'Edge Ratio': edgeRatio,
    'Avg Holding Period': Math.round(avgHold * 10) / 10,
    'Avg Win Hold': Math.round(avgWinHold * 10) / 10,
    'Avg Loss Hold': Math.round(avgLossHold * 10) / 10,
    'Max Win': Math.max(...pnls), 'Max Loss': Math.min(...pnls),
    'Expectancy': expectancy,
    'R Sample': rN,
    'Avg Win R': avgWinR,
    'Avg Loss R': avgLossR,
    'R Win Rate': rWinRate,
  };
}

// --- Utility ---
function fmt(n, decimals = 0) {
  if (n === undefined || n === null) return '\u2014';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPnL(n) {
  const s = '$' + fmt(Math.abs(n), 2);
  return n >= 0 ? '+' + s : '-' + s;
}

function calcEMA(closes, period) {
  const ema = [];
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { ema.push(null); continue; }
    if (prev === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      prev = sum / period;
    } else {
      prev = closes[i] * k + prev * (1 - k);
    }
    ema.push(prev);
  }
  return ema;
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] !== null && emaSlow[i] !== null) macdLine.push(emaFast[i] - emaSlow[i]);
    else macdLine.push(null);
  }
  const nonNull = macdLine.filter(v => v !== null);
  const signalLine = calcEMA(nonNull, signal);
  const result = { macd: [], signal: [], histogram: [] };
  let si = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] === null) {
      result.macd.push(null);
      result.signal.push(null);
      result.histogram.push(null);
    } else {
      const sig = signalLine[si] !== null ? signalLine[si] : null;
      result.macd.push(macdLine[i]);
      result.signal.push(sig);
      result.histogram.push(sig !== null ? macdLine[i] - sig : null);
      si++;
    }
  }
  return result;
}

// --- Stat Bar (Compact) ---
function renderStatBar() {
  const trades = getFilteredTrades();
  const n = trades.length;
  if (n === 0) {
    document.getElementById('stat-bar').innerHTML = `
      <div class="stat-bar-empty">No trades match current filters \u2014 adjust your filters or date range</div>`;
    return;
  }
  const winners = trades.filter(t => t.pnl > 0);
  const losers = trades.filter(t => t.pnl <= 0);
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0);
  const avgPnL = n ? totalPnL / n : 0;
  const sortedPnls = trades.map(t => t.pnl).sort((a, b) => a - b);
  const medianPnL = n ? sortedPnls[Math.floor(n / 2)] : 0;
  const wr = n ? winners.length / n : 0;
  const avgWin = winners.length ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
  const avgLoss = losers.length ? Math.abs(losers.reduce((s, t) => s + t.pnl, 0) / losers.length) : 0;
  const edgeRatio = avgLoss > 0 ? avgWin / avgLoss : 0;

  const rTrades = trades.filter(t => t.rMultiple != null);
  const rN = rTrades.length;
  const rWinners = rTrades.filter(t => t.rMultiple > 0);
  const rLosers = rTrades.filter(t => t.rMultiple <= 0);
  const avgWinR = rWinners.length ? rWinners.reduce((s, t) => s + t.rMultiple, 0) / rWinners.length : 0;
  const avgLossR = rLosers.length ? rLosers.reduce((s, t) => s + t.rMultiple, 0) / rLosers.length : 0;
  const expectancy = rN ? rTrades.reduce((s, t) => s + t.rMultiple, 0) / rN : null;
  const expectancyCls = expectancy == null ? '' : (expectancy >= 0 ? 'positive' : 'negative');
  const expectancyDisplay = expectancy == null
    ? '\u2014'
    : `${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(2)}R`;
  const expectancySub = rN
    ? `n=${rN} \u00B7 W: ${avgWinR >= 0 ? '+' : ''}${avgWinR.toFixed(2)} / L: ${avgLossR.toFixed(2)}`
    : 'no R data';

  document.getElementById('stat-bar').innerHTML = `
    <div class="stat-bar-item">
      <div class="stat-bar-label">Total P&L</div>
      <div class="stat-bar-value ${totalPnL >= 0 ? 'positive' : 'negative'}">${fmtPnL(totalPnL)}</div>
      <div class="stat-bar-sub">${n} trades</div>
    </div>
    <div class="stat-bar-item">
      <div class="stat-bar-label">Win Rate</div>
      <div class="stat-bar-value">${(wr * 100).toFixed(1)}%</div>
      <div class="stat-bar-sub">${winners.length}W / ${losers.length}L</div>
    </div>
    <div class="stat-bar-item">
      <div class="stat-bar-label">Edge Ratio</div>
      <div class="stat-bar-value">${edgeRatio.toFixed(2)}</div>
      <div class="stat-bar-sub">Avg W: ${fmtPnL(Math.round(avgWin))} / L: ${fmtPnL(Math.round(-avgLoss))}</div>
    </div>
    <div class="stat-bar-item">
      <div class="stat-bar-label">Expectancy</div>
      <div class="stat-bar-value ${expectancyCls}">${expectancyDisplay}</div>
      <div class="stat-bar-sub">${expectancySub}</div>
    </div>
    <div class="stat-bar-item">
      <div class="stat-bar-label">Avg P&L</div>
      <div class="stat-bar-value ${avgPnL >= 0 ? 'positive' : 'negative'}">${fmtPnL(avgPnL)}</div>
      <div class="stat-bar-sub">Median: ${fmtPnL(medianPnL)}</div>
    </div>
  `;
}

// --- Regime Color Cards ---
function renderRegimeColorCards() {
  const trades = getFilteredTrades();
  const colors = getRegimeColorConfig().map(c => ({ key: c.key, cls: c.cls, dotColor: c.dotCss }));
  const ttLabels = { 'Trade A': 'A', 'Trade B': 'B', 'Trade E': 'E' };
  const html = colors.map(c => {
    const colorTrades = trades.filter(t => t.regimeColor === c.key);
    const s = computeRegimeStats(colorTrades);
    const totalPnL = s['Total P&L'];
    const nTrades = s['# Trades'];
    const winRate = s['Win Rate'];
    const avgPnL = s['Avg P&L'];
    const edgeRatio = s['Edge Ratio'];
    const avgHold = s['Avg Holding Period'];
    const avgWinHold = s['Avg Win Hold'];
    const avgLossHold = s['Avg Loss Hold'];
    const expectancy = s['Expectancy'];
    const rSample = s['R Sample'];
    const avgWinR = s['Avg Win R'];
    const avgLossR = s['Avg Loss R'];
    const rWinRate = s['R Win Rate'];
    const ttStats = computeTradeTypeStats(colorTrades);
    const ttHtml = TRADE_TYPE_VALUES.map(tt => {
      const ts = ttStats[tt];
      if (ts.count === 0) return '';
      const pnlCls = ts.totalPnL >= 0 ? 'positive' : 'negative';
      return `<div class="tt-breakdown-row">
        <span class="tt-tag trade-type-badge ${tradeTypeClass(tt)}">${ttLabels[tt]}</span>
        <span class="tt-count">${ts.count}</span>
        <span class="tt-pnl ${pnlCls}">${fmtPnL(ts.totalPnL)}</span>
        <span class="tt-wr">${(ts.winRate * 100).toFixed(0)}%</span>
        <span class="tt-er">${ts.edgeRatio ? ts.edgeRatio.toFixed(2) : '\u2014'}</span>
        <span class="tt-hold">${ts.avgHold ? ts.avgHold.toFixed(1) + 'd' : '\u2014'}</span>
      </div>`;
    }).filter(Boolean).join('');
    return `
      <div class="regime-color-card ${c.cls}">
        <div class="color-label">
          <span class="color-dot" style="background:${c.dotColor}"></span>
          ${c.key} Regime
        </div>
        <div class="stats-grid">
          <div class="mini-stat"><div class="mini-label">Total P&L</div><div class="mini-value ${totalPnL >= 0 ? 'positive' : 'negative'}">${fmtPnL(totalPnL)}</div></div>
          <div class="mini-stat"><div class="mini-label"># Trades</div><div class="mini-value">${fmt(nTrades)}</div></div>
          <div class="mini-stat"><div class="mini-label">Win Rate</div><div class="mini-value">${(winRate * 100).toFixed(1)}%</div></div>
          <div class="mini-stat"><div class="mini-label">Avg P&L</div><div class="mini-value ${avgPnL >= 0 ? 'positive' : 'negative'}">${fmtPnL(avgPnL)}</div></div>
          <div class="mini-stat"><div class="mini-label">Edge Ratio</div><div class="mini-value">${edgeRatio ? edgeRatio.toFixed(2) : '\u2014'}</div></div>
          <div class="mini-stat"><div class="mini-label">Avg Hold</div><div class="mini-value">${avgHold ? avgHold.toFixed(1) + 'd' : '\u2014'}</div></div>
          <div class="mini-stat"><div class="mini-label">Avg Win Hold</div><div class="mini-value">${avgWinHold ? avgWinHold.toFixed(1) + 'd' : '\u2014'}</div></div>
          <div class="mini-stat"><div class="mini-label">Avg Loss Hold</div><div class="mini-value">${avgLossHold ? avgLossHold.toFixed(1) + 'd' : '\u2014'}</div></div>
          <div class="mini-stat"><div class="mini-label">Best</div><div class="mini-value positive">${fmtPnL(s['Max Win'] || 0)}</div></div>
          <div class="mini-stat"><div class="mini-label">Worst</div><div class="mini-value negative">${fmtPnL(s['Max Loss'] || 0)}</div></div>
          <div class="mini-stat" title="Van Tharp expectancy = average R-multiple across trades with recorded risk. n=${rSample}">
            <div class="mini-label">Expectancy</div>
            <div class="mini-value ${expectancy == null ? '' : (expectancy >= 0 ? 'positive' : 'negative')}">${expectancy == null ? '\u2014' : (expectancy >= 0 ? '+' : '') + expectancy.toFixed(2) + 'R'}</div>
          </div>
          <div class="mini-stat" title="Win rate on the R-enriched subset (n=${rSample})">
            <div class="mini-label">R Win %</div>
            <div class="mini-value">${rSample ? (rWinRate * 100).toFixed(0) + '%' : '\u2014'}</div>
          </div>
          <div class="mini-stat" title="Average winning R">
            <div class="mini-label">Avg Win R</div>
            <div class="mini-value ${rSample && avgWinR > 0 ? 'positive' : ''}">${rSample ? (avgWinR >= 0 ? '+' : '') + avgWinR.toFixed(2) + 'R' : '\u2014'}</div>
          </div>
          <div class="mini-stat" title="Average losing R">
            <div class="mini-label">Avg Loss R</div>
            <div class="mini-value ${rSample && avgLossR < 0 ? 'negative' : ''}">${rSample ? avgLossR.toFixed(2) + 'R' : '\u2014'}</div>
          </div>
        </div>
        ${ttHtml ? `<span class="tt-toggle-link" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'':'none';this.textContent=this.nextElementSibling.style.display==='none'?'Show trade types \u25B6':'Hide trade types \u25BC'">Show trade types \u25B6</span>
        <div class="tt-breakdown" style="display:none;"><div class="tt-breakdown-label">By Trade Type</div>
          <div class="tt-breakdown-row tt-breakdown-header">
            <span class="tt-tag" style="visibility:hidden">A</span>
            <span class="tt-count" style="color:var(--text-muted);font-size:10px">#</span>
            <span class="tt-pnl" style="color:var(--text-muted);font-size:10px">P&L</span>
            <span class="tt-wr" style="color:var(--text-muted);font-size:10px">HIT</span>
            <span class="tt-er" style="color:var(--text-muted);font-size:10px">EDGE</span>
            <span class="tt-hold" style="color:var(--text-muted);font-size:10px">HOLD</span>
          </div>${ttHtml}</div>` : ''}
      </div>`;
  }).join('');
  document.getElementById('regime-color-cards').innerHTML = html;
}

// --- Strategy Performance ---
function renderStrategyPerformance() {
  const trades = getFilteredTrades();
  const regimes = getRegimeColorConfig().map(c => ({ color: c.key, cls: c.panelCls, dotColor: c.dotCss }));
  const isRexp = pnlDisplayMode === 'rexp';
  const useTotal = pnlDisplayMode === 'total';
  const panels = regimes.map(r => {
    const data = computeStrategyExpectancy(trades, r.color);
    const getVal = d => isRexp ? d.rExpectancy : useTotal ? d.totalPnL : d.expectancy;
    const isEmpty = d => isRexp ? d.rCount === 0 : d.count === 0;
    const getN = d => isRexp ? d.rCount : d.count;
    const withData = data.filter(d => !isEmpty(d));
    const maxAbs = withData.length > 0 ? Math.max(...withData.map(d => Math.abs(getVal(d)))) : 1;
    const rows = data.map(d => {
      if (isEmpty(d)) {
        return `<div class="strategy-bar-row">
          <div class="strategy-bar-label">${strategyLabel(d.strategy)}\u2020</div>
          <div class="strategy-bar-container"></div>
          <div class="strategy-bar-value" style="color:var(--text-dim)"></div>
          <div class="strategy-bar-n">n=0*</div>
        </div>`;
      }
      const val = getVal(d);
      const pct = Math.min(100, (Math.abs(val) / maxAbs) * 100);
      const barCls = val >= 0 ? 'bar-positive' : 'bar-negative';
      const valCls = val >= 0 ? 'positive' : 'negative';
      const n = getN(d);
      const lowSample = n > 0 && n < 30;
      const dagger = lowSample ? '\u2020' : '';
      const rowCls = lowSample ? ' low-sample' : '';
      const valText = isRexp ? fmtRExp(val) : fmtPnL(Math.round(val));
      return `<div class="strategy-bar-row${rowCls}">
        <div class="strategy-bar-label">${strategyLabel(d.strategy)}${dagger}</div>
        <div class="strategy-bar-container">
          <div class="strategy-bar ${barCls}" style="width:${pct}%"></div>
        </div>
        <div class="strategy-bar-value ${valCls}">${valText}</div>
        <div class="strategy-bar-n">n=${n}${lowSample ? '*' : ''}</div>
      </div>`;
    }).join('');
    return `<div class="strategy-panel ${r.cls}">
      <div class="strategy-panel-title">
        <span class="color-dot" style="background:${r.dotColor}"></span>
        ${r.color} Regime
      </div>
      ${rows}
    </div>`;
  }).join('');
  const spAvgActive = pnlDisplayMode === 'avg' ? ' active' : '';
  const spTotalActive = pnlDisplayMode === 'total' ? ' active' : '';
  const spRexpActive = pnlDisplayMode === 'rexp' ? ' active' : '';
  const spModeLabel = isRexp ? 'Expectancy (R)' : useTotal ? 'Total P&L' : 'Avg P&L';
  document.getElementById('strategy-perf-section').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:10px;">
      <div class="indicator-toggles" style="margin-bottom:0;">
        <div class="indicator-toggle sp-pnl-toggle${spAvgActive}" data-pnl-mode="avg" style="color:#e5bb76;border-color:#e5bb76;background:rgba(229,187,118,0.12);">Avg P&L</div>
        <div class="indicator-toggle sp-pnl-toggle${spTotalActive}" data-pnl-mode="total" style="color:#e5bb76;border-color:#e5bb76;background:rgba(229,187,118,0.12);">Total P&L</div>
        <div class="indicator-toggle sp-pnl-toggle${spRexpActive}" data-pnl-mode="rexp" style="color:#e5bb76;border-color:#e5bb76;background:rgba(229,187,118,0.12);">Expectancy</div>
      </div>
    </div>
    <div class="strategy-perf-subtitle">Showing ${spModeLabel} \u00B7 \u2020 = thin cell (n &lt; 30), descriptive only &nbsp;&nbsp; * = small sample${isRexp ? ' &nbsp;&nbsp; \u00B7 Only trades with recorded risk counted' : ''}</div>
    <div class="strategy-panels">${panels}</div>
  `;

  document.querySelectorAll('.sp-pnl-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      pnlDisplayMode = btn.dataset.pnlMode;
      renderStrategyPerformance();
      renderStrategyRegimeHeatmap();
    });
  });
}

// --- Chart Creation ---
function regimeColorToHex(color) {
  const entry = getColorEntry(color);
  return entry.hex;
}

function createEquityChart() {
  const container = document.getElementById('equity-chart');
  equityChart = LightweightCharts.createChart(container, CHART_OPTS);
  for (const [color, fill] of Object.entries(ALL_BAND_CONFIG)) {
    equityBandSeries[color] = equityChart.addAreaSeries({
      lineWidth: 0, lineColor: 'transparent',
      topColor: fill.top, bottomColor: fill.bottom,
      lineType: 1,
      priceScaleId: 'regime',
      lastValueVisible: false, priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
  }
  equityChart.priceScale('regime').applyOptions({
    visible: false, scaleMargins: { top: 0, bottom: 0 },
  });
  equityLineSeries = equityChart.addLineSeries({
    color: '#e5bb76', lineWidth: 2,
    lastValueVisible: true, priceLineVisible: false,
  });
  for (const [key, cfg] of Object.entries(OVERLAY_CONFIG)) {
    overlaySeries[key] = equityChart.addLineSeries({
      color: cfg.color, lineWidth: cfg.lineWidth, priceScaleId: cfg.priceScaleId,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      visible: overlayState[key], title: cfg.label,
    });
    equityChart.priceScale(cfg.priceScaleId).applyOptions({
      visible: false, scaleMargins: { top: 0.05, bottom: 0.05 },
    });
  }
}

function getRegimeColorForDate(date, regimeKey) {
  const periods = DATA.regimePeriods[regimeKey];
  if (!periods) return 'Unknown';
  for (const p of periods) {
    if (date >= p.start && date <= p.end) return p.color;
  }
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < sorted.length - 1; i++) {
    if (date > sorted[i].end && date < sorted[i+1].start) return sorted[i].color;
  }
  return 'Unknown';
}

function buildRegimeBandData(dates, regimeKey) {
  const bands = {};
  for (const c of ALL_BAND_COLORS) bands[c] = [];
  for (let i = 0; i < dates.length; i++) {
    const color = getRegimeColorForDate(dates[i], regimeKey);
    for (const c of ALL_BAND_COLORS) {
      bands[c].push({ time: dates[i], value: color === c ? 1 : 0 });
    }
  }
  return bands;
}

function getEquityCurveData() {
  if (allFiltersSelected()) return DATA.equityCurve;
  return buildEquityCurve(getFilteredTrades());
}

function renderEquityChart() {
  const ec = getEquityCurveData();
  const regimeKey = 'regime' + currentRegime;
  equityLineSeries.setData(ec.map(e => ({ time: e.date, value: e.cumPnL })));
  const bands = buildRegimeBandData(ec.map(e => e.date), regimeKey);
  for (const color of ALL_BAND_COLORS) {
    if (equityBandSeries[color]) equityBandSeries[color].setData(bands[color]);
  }
  const overlays = DATA.overlays || {};
  for (const key of Object.keys(OVERLAY_CONFIG)) {
    if (overlays[key] && overlaySeries[key]) overlaySeries[key].setData(overlays[key]);
  }
  equityChart.timeScale().fitContent();
}

function createDrawdownChart() {
  const container = document.getElementById('drawdown-chart');
  drawdownChart = LightweightCharts.createChart(container, CHART_OPTS);
  for (const [color, fill] of Object.entries(ALL_BAND_CONFIG)) {
    drawdownBandSeries[color] = drawdownChart.addAreaSeries({
      lineWidth: 0, lineColor: 'transparent',
      topColor: fill.top, bottomColor: fill.bottom,
      lineType: 1, priceScaleId: 'regime',
      lastValueVisible: false, priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
  }
  drawdownChart.priceScale('regime').applyOptions({
    visible: false, scaleMargins: { top: 0, bottom: 0 },
  });
  drawdownSeries = drawdownChart.addAreaSeries({
    lineColor: '#ff453a', topColor: 'rgba(255,69,58,0.05)',
    bottomColor: 'rgba(255,69,58,0.28)', lineWidth: 2, invertFilledArea: true,
  });
}

function renderDrawdownChart() {
  const ec = getEquityCurveData();
  const regimeKey = 'regime' + currentRegime;
  drawdownSeries.setData(ec.map(e => ({ time: e.date, value: e.drawdown })));
  const bands = buildRegimeBandData(ec.map(e => e.date), regimeKey);
  for (const color of ALL_BAND_COLORS) {
    if (drawdownBandSeries[color]) drawdownBandSeries[color].setData(bands[color]);
  }
  drawdownChart.timeScale().fitContent();
}

function syncEquityDrawdown() {
  let syncing = false;
  equityChart.timeScale().subscribeVisibleTimeRangeChange(range => {
    if (syncing || !range) return;
    syncing = true;
    try { drawdownChart.timeScale().setVisibleRange(range); } catch(e) {}
    syncing = false;
  });
  drawdownChart.timeScale().subscribeVisibleTimeRangeChange(range => {
    if (syncing || !range) return;
    syncing = true;
    try { equityChart.timeScale().setVisibleRange(range); } catch(e) {}
    syncing = false;
  });
  equityChart.subscribeCrosshairMove(param => {
    if (param.time) drawdownChart.setCrosshairPosition(0, param.time, drawdownSeries);
    else drawdownChart.clearCrosshairPosition();
  });
  drawdownChart.subscribeCrosshairMove(param => {
    if (param.time) equityChart.setCrosshairPosition(0, param.time, equityLineSeries);
    else equityChart.clearCrosshairPosition();
  });
}

// --- Performers ---
function renderPerformers() {
  const trades = getFilteredTrades();
  const filtered = currentColorFilter === 'all' ? trades : trades.filter(t => t.regimeColor === currentColorFilter);
  if (filtered.length === 0) {
    const emptyMsg = '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:13px;">No trades match current filters</div>';
    document.getElementById('top-performers').innerHTML = emptyMsg;
    document.getElementById('bottom-performers').innerHTML = emptyMsg;
    return;
  }
  const sorted = [...filtered].sort((a, b) => b.pnl - a.pnl);
  const top5 = sorted.slice(0, 5);
  const bottom5 = sorted.slice(-5).reverse();
  window._performerNavIds = top5.concat(bottom5).map(t => t.tradeId);
  renderPerformerList('top-performers', top5, 'top');
  renderPerformerList('bottom-performers', bottom5, 'bottom');
}

function renderPerformerList(containerId, items, type) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.map((t, i) => {
    const isOpt = t.type === 'Equity and Index Options';
    const pctChange = (!isOpt && t.entry > 0) ? ((t.exit - t.entry) / t.entry * 100) : null;
    const isTop = type === 'top';
    const strategyTag = t.strategy ? `<span style="color:var(--text-dim);font-size:11px;"> (${t.strategy})</span>` : '';
    return `
      <div class="performer-item" onclick="showTradeDetail(${t.tradeId}, window._performerNavIds)">
        <div class="performer-rank ${isTop ? 'top-rank' : 'bottom-rank'}">${i + 1}</div>
        <div class="performer-info">
          <div class="performer-symbol">${t.symbol}${strategyTag}</div>
          <div class="performer-date">${t.entryDate} &rarr; ${t.exitDate} \u00B7 ${t.side} \u00B7 <span class="regime-badge badge-${t.regimeColor}">${t.regimeColor}</span></div>
        </div>
        <div style="text-align:right;">
          <div class="performer-pnl ${t.pnl >= 0 ? 'positive' : 'negative'}">${fmtPnL(t.pnl)}</div>
          <div style="font-size:11px; color:var(--text-dim);">${pctChange !== null ? `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}%` : (t.strategy || 'Options')}</div>
        </div>
      </div>`;
  }).join('');
}

// --- Trade Detail ---
function calcHoldingDays(entry, exit) {
  const d1 = new Date(entry), d2 = new Date(exit);
  return Math.round((d2 - d1) / 86400000);
}

function showTradeDetail(tradeId, sourceNavList) {
  const overlay = document.getElementById('trade-detail-overlay');
  const isAlreadyOpen = overlay.classList.contains('open');

  if (!isAlreadyOpen) {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    // Set navigation list on first open
    if (sourceNavList) {
      navList = sourceNavList;
    } else {
      navList = getTableFilteredSorted().map(t => t.tradeId);
    }
  }

  const trades = getTrades();
  const trade = trades.find(t => t.tradeId === tradeId);
  if (!trade) return;

  selectedTradeIdx = tradeId;

  // Update navigation position indicator
  const navEl = document.getElementById('panel-nav');
  if (navList && navList.length > 1) {
    const pos = navList.indexOf(tradeId);
    document.getElementById('panel-nav-pos').textContent = `${pos + 1} / ${navList.length}`;
    navEl.style.display = 'flex';
  } else {
    navEl.style.display = 'none';
  }

  const holdDays = calcHoldingDays(trade.entryDate, trade.exitDate);
  document.getElementById('trade-detail-title').textContent = `${trade.symbol} \u2014 Trade Detail`;
  const isOptions = trade.type === 'Equity and Index Options';
  const pctChange = (!isOptions && trade.entry > 0) ? ((trade.exit - trade.entry) / trade.entry * 100) : null;
  const typeLabel = trade.strategy || (isOptions ? 'Options' : trade.type);
  document.getElementById('trade-detail-meta').innerHTML = `
    <span class="trade-meta-item"><span class="dot" style="background:${regimeColorToHex(trade.regimeColor)}"></span> ${trade.regimeColor}</span>
    <span class="trade-meta-item">${trade.entryDate} &rarr; ${trade.exitDate} (${holdDays}d)</span>
    <span class="trade-meta-item">${trade.side} \u00B7 ${typeLabel}</span>
    ${trade.primaryStrategy ? `<span class="trade-meta-item"><span class="strategy-badge ${strategyClass(trade.primaryStrategy)}">${strategyLabel(trade.primaryStrategy)}</span></span>` : ''}
    ${trade.tradeType ? `<span class="trade-meta-item"><span class="trade-type-badge ${tradeTypeClass(trade.tradeType)}">${trade.tradeType}</span></span>` : ''}
    <span class="trade-meta-item">Qty: ${fmt(trade.qty)}</span>
    <span class="trade-meta-item">${isOptions ? 'Premium' : 'Entry'}: $${trade.entry.toFixed(2)}</span>
    <span class="trade-meta-item">${isOptions ? 'Close' : 'Exit'}: $${trade.exit.toFixed(2)}</span>
    <span class="trade-meta-item ${trade.pnl >= 0 ? 'positive' : 'negative'}">P&L: ${fmtPnL(trade.pnl)}</span>
    ${pctChange !== null ? `<span class="trade-meta-item">${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%</span>` : ''}
    <span class="trade-meta-item">Fees: $${Math.abs(trade.fees).toFixed(2)}</span>
    ${trade.plannedEntry != null ? `<span class="trade-meta-item">Sized: $${trade.plannedEntry.toFixed(2)}</span>` : ''}
    ${trade.plannedCut != null ? `<span class="trade-meta-item">Plan Cut: $${trade.plannedCut.toFixed(2)}</span>` : ''}
    ${trade.riskDollars != null ? `<span class="trade-meta-item">Risk: $${fmt(trade.riskDollars)}</span>` : ''}
    ${trade.rMultiple != null ? `<span class="trade-meta-item ${trade.rMultiple >= 0 ? 'positive' : 'negative'}">R: ${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}</span>` : ''}
  `;

  // Render chart after panel is visible
  const delay = isAlreadyOpen ? 0 : 50;
  setTimeout(() => renderTradeChart(trade), delay);
}

function renderTradeChart(trade) {
  const container = document.getElementById('trade-chart');
  const macdContainer = document.getElementById('macd-chart');
  container.innerHTML = '';
  macdContainer.innerHTML = '';
  tradeEmaSeries = {};

  const baseTicker = trade.symbol.split(' ')[0];
  const tickerData = OHLC[baseTicker];
  const isWin = trade.pnl >= 0;
  const entryPrice = trade.entry;
  const exitPrice = trade.exit;

  if (!tickerData || tickerData.length === 0) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);">No historical data available for ' + baseTicker + '</div>';
    macdContainer.style.display = 'none';
    return;
  }

  const entryIdx = tickerData.findIndex(d => d.t >= trade.entryDate);
  let exitIdx = tickerData.findIndex(d => d.t >= trade.exitDate);
  if (exitIdx === -1) exitIdx = tickerData.length - 1;

  if (entryIdx === -1) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-dim);">Trade date not found in OHLC data for ' + baseTicker + '</div>';
    macdContainer.style.display = 'none';
    return;
  }

  const tradeDuration = Math.max(1, exitIdx - entryIdx);
  const paddingBefore = Math.max(CANDLES_BEFORE, Math.round(tradeDuration * 0.5));
  const paddingAfter = Math.max(CANDLES_AFTER, Math.round(tradeDuration * 0.3));
  const calcStart = Math.max(0, entryIdx - paddingBefore - 200);
  const visibleStart = Math.max(0, entryIdx - paddingBefore);
  const end = Math.min(tickerData.length, exitIdx + paddingAfter + 1);
  const calcSlice = tickerData.slice(calcStart, end);
  const visibleOffset = visibleStart - calcStart;

  const candleData = [];
  for (let i = visibleOffset; i < calcSlice.length; i++) {
    const d = calcSlice[i];
    candleData.push({ time: d.t, open: d.o, high: d.h, low: d.l, close: d.c });
  }

  const allCloses = calcSlice.map(d => d.c);

  tradeChart = LightweightCharts.createChart(container, CHART_OPTS);

  // Regime background bands
  tradeRegimeBandSeries = {};
  const regimeKey = 'regime' + currentRegime;
  for (const [color, fill] of Object.entries(ALL_BAND_CONFIG)) {
    tradeRegimeBandSeries[color] = tradeChart.addAreaSeries({
      lineWidth: 0, lineColor: 'transparent',
      topColor: fill.top, bottomColor: fill.bottom,
      lineType: 1, priceScaleId: 'tradeRegime',
      lastValueVisible: false, priceLineVisible: false,
      crosshairMarkerVisible: false,
      visible: !!tradeRegimeState[color],
    });
  }
  tradeChart.priceScale('tradeRegime').applyOptions({
    visible: false, scaleMargins: { top: 0, bottom: 0 },
  });
  const tradeDates = candleData.map(d => d.time);
  const tradeRegimeBands = buildRegimeBandData(tradeDates, regimeKey);
  for (const color of ALL_BAND_COLORS) {
    if (tradeRegimeBandSeries[color]) tradeRegimeBandSeries[color].setData(tradeRegimeBands[color]);
  }

  tradeSeries = tradeChart.addCandlestickSeries({
    upColor: '#30d158', downColor: '#ff453a',
    borderUpColor: '#30d158', borderDownColor: '#ff453a',
    wickUpColor: '#30d158', wickDownColor: '#ff453a',
  });
  tradeSeries.setData(candleData);

  // EMA lines
  for (const [key, cfg] of Object.entries(EMA_CONFIG)) {
    const emaValues = calcEMA(allCloses, cfg.period);
    const emaData = [];
    for (let i = visibleOffset; i < calcSlice.length; i++) {
      if (emaValues[i] !== null) {
        emaData.push({ time: calcSlice[i].t, value: Math.round(emaValues[i] * 100) / 100 });
      }
    }
    const series = tradeChart.addLineSeries({
      color: cfg.color, lineWidth: 1, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: false,
      visible: indicatorState[key],
      title: cfg.label,
    });
    series.setData(emaData);
    tradeEmaSeries[key] = series;
  }

  // Entry/exit markers — one arrow per fill (per trading day)
  const isOptions = trade.type === 'Equity and Index Options';
  const entryLegs = Array.isArray(trade.entryLegs) && trade.entryLegs.length ? trade.entryLegs : null;
  const exitLegs = Array.isArray(trade.exitLegs) && trade.exitLegs.length ? trade.exitLegs : null;

  const snapToCandle = (date, fallback) =>
    candleData.find(d => d.time >= date)?.time || fallback;

  const markers = [];

  if (entryLegs) {
    for (const leg of entryLegs) {
      markers.push({
        time: snapToCandle(leg.date, candleData[0].time),
        position: 'belowBar', color: '#e5bb76', shape: 'arrowUp',
        text: isOptions ? 'Entry' : `$${leg.price.toFixed(2)}`,
      });
    }
  } else {
    markers.push({
      time: snapToCandle(trade.entryDate, candleData[0].time),
      position: 'belowBar', color: '#e5bb76', shape: 'arrowUp',
      text: isOptions ? 'Entry' : `$${entryPrice.toFixed(2)}`,
    });
  }

  if (exitLegs) {
    for (const leg of exitLegs) {
      markers.push({
        time: snapToCandle(leg.date, candleData[candleData.length - 1].time),
        position: 'aboveBar', color: isWin ? '#30d158' : '#ff453a', shape: 'arrowDown',
        text: isOptions ? `Exit ${fmtPnL(trade.pnl)}` : `$${leg.price.toFixed(2)}`,
      });
    }
  } else {
    markers.push({
      time: snapToCandle(trade.exitDate, candleData[candleData.length - 1].time),
      position: 'aboveBar', color: isWin ? '#30d158' : '#ff453a', shape: 'arrowDown',
      text: isOptions ? `Exit ${fmtPnL(trade.pnl)}` : `$${exitPrice.toFixed(2)}`,
    });
  }

  markers.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  tradeSeries.setMarkers(markers);

  tradeChart.timeScale().fitContent();

  // MACD chart
  macdContainer.style.display = 'block';
  macdChart = LightweightCharts.createChart(macdContainer, {
    ...CHART_OPTS,
    rightPriceScale: { borderColor: 'rgba(229, 187, 118, 0.2)', scaleMargins: { top: 0.1, bottom: 0.1 } },
  });

  const macdResult = calcMACD(allCloses, 12, 26, 9);

  const histData = [];
  for (let i = visibleOffset; i < calcSlice.length; i++) {
    if (macdResult.histogram[i] !== null) {
      histData.push({
        time: calcSlice[i].t,
        value: Math.round(macdResult.histogram[i] * 10000) / 10000,
        color: macdResult.histogram[i] >= 0 ? 'rgba(48,209,88,0.6)' : 'rgba(255,69,58,0.6)',
      });
    }
  }
  macdHistSeries = macdChart.addHistogramSeries({
    priceLineVisible: false, lastValueVisible: false,
  });
  macdHistSeries.setData(histData);

  const macdLineData = [];
  for (let i = visibleOffset; i < calcSlice.length; i++) {
    if (macdResult.macd[i] !== null) {
      macdLineData.push({ time: calcSlice[i].t, value: Math.round(macdResult.macd[i] * 10000) / 10000 });
    }
  }
  macdLineSeries = macdChart.addLineSeries({
    color: '#7fb3d9', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: 'MACD',
  });
  macdLineSeries.setData(macdLineData);

  const signalData = [];
  for (let i = visibleOffset; i < calcSlice.length; i++) {
    if (macdResult.signal[i] !== null) {
      signalData.push({ time: calcSlice[i].t, value: Math.round(macdResult.signal[i] * 10000) / 10000 });
    }
  }
  macdSignalSeries = macdChart.addLineSeries({
    color: '#ff9a7a', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'Signal',
    lineStyle: LightweightCharts.LineStyle.Dashed,
  });
  macdSignalSeries.setData(signalData);

  macdHistSeries.createPriceLine({
    price: 0, color: 'rgba(229, 187, 118, 0.3)', lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false,
  });

  macdChart.timeScale().fitContent();

  if (!indicatorState.macd) macdContainer.style.display = 'none';

  // Sync crosshairs
  tradeChart.subscribeCrosshairMove(param => {
    if (param.time) macdChart.setCrosshairPosition(0, param.time, macdHistSeries);
    else macdChart.clearCrosshairPosition();
  });
  macdChart.subscribeCrosshairMove(param => {
    if (param.time) tradeChart.setCrosshairPosition(0, param.time, tradeSeries);
    else tradeChart.clearCrosshairPosition();
  });

  // Sync time scale
  tradeChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (range) macdChart.timeScale().setVisibleLogicalRange(range);
  });
  macdChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (range) tradeChart.timeScale().setVisibleLogicalRange(range);
  });
}

// --- Trade Table ---
function getTableFilteredSorted() {
  let filtered = [...getTrades()];
  if (searchTerm) filtered = filtered.filter(t =>
    t.symbol.toLowerCase().includes(searchTerm) ||
    (t.strategy && t.strategy.toLowerCase().includes(searchTerm)) ||
    (t.primaryStrategy && t.primaryStrategy.toLowerCase().includes(searchTerm)) ||
    (t.tradeType && t.tradeType.toLowerCase().includes(searchTerm))
  );
  filtered = filtered.filter(t => selectedColors.has(t.regimeColor));
  filtered = filtered.filter(t => selectedExitColors.has(t.exitRegimeColor));
  filtered = filtered.filter(t => selectedTypes.has(t.type));
  filtered = filtered.filter(t => selectedStrategies.has(t.primaryStrategy || '(Untagged)'));
  filtered = filtered.filter(t => selectedTradeTypes.has(t.tradeType || '(Untagged)'));
  if (dateFrom) filtered = filtered.filter(t => t.entryDate >= dateFrom);
  if (dateTo) filtered = filtered.filter(t => t.entryDate <= dateTo);
  filtered.sort((a, b) => {
    let va = a[sortField], vb = b[sortField];
    if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
    return (va - vb) * sortDir;
  });
  return filtered;
}

function renderTable() {
  const filtered = getTableFilteredSorted();

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (filtered.length === 0) {
    document.getElementById('trades-tbody').innerHTML = `<tr><td colspan="15" style="padding:32px;text-align:center;color:var(--text-dim);font-size:13px;">No trades match your filters</td></tr>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  document.getElementById('trades-tbody').innerHTML = pageItems.map(t => `
    <tr onclick="showTradeDetail(${t.tradeId})">
      <td>${t.entryDate}</td>
      <td>${t.exitDate}</td>
      <td style="font-weight:600;">${t.symbol}</td>
      <td>${t.side}</td>
      <td style="font-size:13px;">${t.strategy || (t.type === 'Equity and Index Options' ? 'Options' : t.type)}</td>
      <td onclick="event.stopPropagation()">${t.primaryStrategy
        ? `<span class="strategy-badge ${strategyClass(t.primaryStrategy)}" onclick="showTagDropdown(event,${t.tradeId},'primaryStrategy','${t.primaryStrategy}')">${strategyLabel(t.primaryStrategy)}</span>`
        : `<span class="tag-empty" onclick="showTagDropdown(event,${t.tradeId},'primaryStrategy','')">+</span>`
      }</td>
      <td onclick="event.stopPropagation()">${t.tradeType
        ? `<span class="trade-type-badge ${tradeTypeClass(t.tradeType)}" onclick="showTagDropdown(event,${t.tradeId},'tradeType','${t.tradeType}')">${t.tradeType}</span>`
        : `<span class="tag-empty" onclick="showTagDropdown(event,${t.tradeId},'tradeType','')">+</span>`
      }</td>
      <td>${fmt(t.qty)}</td>
      <td>$${t.entry.toFixed(2)}</td>
      <td>$${t.exit.toFixed(2)}</td>
      <td class="${t.pnl >= 0 ? 'positive' : 'negative'}" style="font-weight:600;">${fmtPnL(t.pnl)}</td>
      <td class="${t.rMultiple != null && t.rMultiple >= 0 ? 'positive' : (t.rMultiple != null ? 'negative' : '')}" style="font-weight:600;">${t.rMultiple != null ? (t.rMultiple >= 0 ? '+' : '') + t.rMultiple.toFixed(2) : ''}</td>
      <td style="color:var(--text-dim);">$${Math.abs(t.fees).toFixed(2)}</td>
      <td><span class="regime-badge badge-${t.regimeColor}">${t.regimeColor}</span></td>
      <td><span class="regime-badge badge-${t.exitRegimeColor}">${t.exitRegimeColor}</span></td>
    </tr>
  `).join('');

  const pag = document.getElementById('pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }
  let pagHtml = `<button class="page-btn" onclick="goPage(${Math.max(1, currentPage - 1)})">&laquo;</button>`;
  let startPage = Math.max(1, currentPage - 3);
  let endPage = Math.min(totalPages, startPage + 6);
  if (endPage - startPage < 6) startPage = Math.max(1, endPage - 6);
  for (let p = startPage; p <= endPage; p++) {
    pagHtml += `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
  }
  pagHtml += `<button class="page-btn" onclick="goPage(${Math.min(totalPages, currentPage + 1)})">&raquo;</button>`;
  pagHtml += `<span class="page-info">${filtered.length} trades</span>`;
  pag.innerHTML = pagHtml;
}

function goPage(p) { currentPage = p; renderTable(); }

// --- Trades Tab Badge ---
function updateTradesTabBadge() {
  const badge = document.getElementById('trades-badge');
  if (allFiltersSelected()) {
    badge.style.display = 'none';
  } else {
    let count = 0;
    const nc = getRegimeColorKeys().length + 1;
    if (selectedColors.size < nc) count++;
    if (selectedExitColors.size < nc) count++;
    if (selectedTypes.size < 2) count++;
    if (selectedStrategies.size < STRATEGY_VALUES.length + 1) count++;
    if (selectedTradeTypes.size < TRADE_TYPE_VALUES.length + 1) count++;
    if (dateFrom || dateTo) count++;
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  }
}

// ==========================================
// SIZING LAB
// ==========================================

function setupSizingLab() {
  // Wire up the controls. Render runs only when the user switches to the tab.
  const sortSel = document.getElementById('sizing-history-sort');
  if (sortSel) sortSel.addEventListener('change', () => {
    sizingHistorySort = sortSel.value;
    renderSizingHistoryTable();
  });
  const dedupeChk = document.getElementById('sizing-history-dedupe');
  if (dedupeChk) dedupeChk.addEventListener('change', () => {
    sizingHistoryDedupe = dedupeChk.checked;
    renderSizingHistoryTable();
  });
  const showBest = document.getElementById('sizing-show-best');
  if (showBest) showBest.addEventListener('click', () => {
    const best = sizingBestRun();
    if (best) { sizingActiveRunId = best.id; renderSizingLab(); }
  });
  const showBaseline = document.getElementById('sizing-show-baseline');
  if (showBaseline) showBaseline.addEventListener('click', () => {
    const b = sizingBaselineRun();
    if (b) { sizingActiveRunId = b.id; renderSizingLab(); }
  });
  // Sortable per-strategy table
  document.querySelectorAll('.sizing-strategy-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.sort;
      if (sizingStrategySort.field === f) sizingStrategySort.dir *= -1;
      else { sizingStrategySort.field = f; sizingStrategySort.dir = -1; }
      renderSizingStrategyTable();
    });
  });
  // Heatmap metric selector
  const hmSel = document.getElementById('sizing-heatmap-metric');
  if (hmSel) hmSel.addEventListener('change', () => {
    sizingHeatmapMetric = hmSel.value;
    renderSizingHeatmap();
  });
  // Badge with run count
  const badge = document.getElementById('sizing-badge');
  const n = SIZING_RUNS && SIZING_RUNS.runs ? SIZING_RUNS.runs.length : 0;
  if (badge) {
    if (n > 0) { badge.textContent = n; badge.style.display = ''; }
    else badge.style.display = 'none';
  }
}

function sizingBaselineRun() {
  if (!SIZING_RUNS || !SIZING_RUNS.runs) return null;
  return SIZING_RUNS.runs.find(r => r.is_baseline) || null;
}

function sizingBestRun() {
  if (!SIZING_RUNS || !SIZING_RUNS.runs || SIZING_RUNS.runs.length === 0) return null;
  let best = null;
  for (const r of SIZING_RUNS.runs) {
    if (best == null || r.aggregate.expectancy_R > best.aggregate.expectancy_R) best = r;
  }
  return best;
}

function sizingActiveRun() {
  if (!SIZING_RUNS || !SIZING_RUNS.runs || SIZING_RUNS.runs.length === 0) return null;
  if (sizingActiveRunId) {
    const found = SIZING_RUNS.runs.find(r => r.id === sizingActiveRunId);
    if (found) return found;
  }
  return sizingBestRun();
}

function renderSizingLab() {
  const empty = document.getElementById('sizing-empty');
  const content = document.getElementById('sizing-content');
  const runs = (SIZING_RUNS && SIZING_RUNS.runs) || [];
  if (runs.length === 0) {
    if (empty) empty.style.display = '';
    if (content) content.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = '';

  // Default the active run to the best the first time we render
  if (!sizingActiveRunId) {
    const best = sizingBestRun();
    if (best) sizingActiveRunId = best.id;
  }

  renderSizingActiveHeader();
  renderSizingStatCards();
  renderSizingNotable();
  renderSizingHeatmap();
  renderSizingStrategyTable();
  renderSizingHistoryTable();
  document.getElementById('sizing-run-count').textContent = runs.length;
}

function _modeLabel(mode) {
  if (mode === 'rescale') return 'rescale (real exits)';
  if (mode === 'sim_2d') return 'sim 2D (rule exits)';
  if (mode === 'sim_1d') return 'sim 1D (rule exits)';
  return mode || 'unknown';
}

function renderSizingActiveHeader() {
  const active = sizingActiveRun();
  if (!active) return;
  const idEl = document.getElementById('sizing-active-id');
  const noteEl = document.getElementById('sizing-active-note');
  const baseline = sizingBaselineRun();
  const isBase = baseline && active.id === baseline.id;
  const cv = active.params.cut_pct;
  const mode = active.params.mode || (cv != null ? 'sim_2d' : 'sim_1d');
  let cutHtml;
  if (mode === 'rescale') {
    cutHtml = ' &middot; <em>real entries &amp; exits</em>';
  } else if (cv != null) {
    cutHtml = `, cut_pct = <strong>${cv.toFixed(3)}</strong>`;
  } else {
    cutHtml = ', cut = <em>historical</em>';
  }
  idEl.innerHTML = `sizing_pct = <strong>${active.params.sizing_pct.toFixed(3)}</strong>${cutHtml}`
    + ` <span class="sizing-tag sizing-tag-mode">${_modeLabel(mode)}</span>`
    + (isBase ? ' <span class="sizing-tag sizing-tag-base">baseline</span>' : '');
  noteEl.textContent = active.note || '';
}

function _fmtR(x) { if (x == null) return '—'; return (x >= 0 ? '+' : '') + x.toFixed(2) + 'R'; }
function _fmtPct(x) { if (x == null) return '—'; return (x * 100).toFixed(1) + '%'; }
function _fmtMoney(x) {
  if (x == null) return '—';
  const sign = x < 0 ? '-' : '';
  return sign + '$' + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function _fmtIntOrDash(x) { return x == null ? '—' : x.toString(); }
function _fmtNumOrDash(x, dec) { return x == null ? '—' : x.toFixed(dec); }
function _deltaCls(d) {
  if (d == null) return '';
  if (d > 0) return 'sizing-delta-pos';
  if (d < 0) return 'sizing-delta-neg';
  return '';
}
function _signed(x, dec = 2, suffix = '') {
  if (x == null) return '—';
  const s = x >= 0 ? '+' : '';
  return s + x.toFixed(dec) + suffix;
}

function renderSizingStatCards() {
  const active = sizingActiveRun();
  const baseline = sizingBaselineRun();
  if (!active) return;
  const a = active.aggregate;
  const d = active.deltas_vs_baseline || {};
  const cards = [
    {
      label: 'Expectancy', value: _fmtR(a.expectancy_R),
      delta: d.expectancy_R, deltaSuffix: 'R',
    },
    {
      label: 'Win rate', value: _fmtPct(a.win_rate),
      delta: d.win_rate != null ? d.win_rate * 100 : null, deltaSuffix: '%',
    },
    {
      label: 'Stop-outs', value: _fmtIntOrDash(a.stop_outs),
      delta: d.stop_outs, deltaSuffix: '', isInt: true,
    },
    {
      label: 'Avg holding (days)', value: _fmtNumOrDash(a.avg_holding_days, 1),
      delta: d.avg_holding_days, deltaSuffix: 'd',
    },
    {
      label: 'Total P&L', value: _fmtMoney(a.total_pnl),
      delta: d.total_pnl, deltaSuffix: '', isMoney: true,
    },
    {
      label: '1R fill rate', value: _fmtPct(a.tranche_fill_rate_1R),
      delta: null,
    },
    {
      label: '2R fill rate', value: _fmtPct(a.tranche_fill_rate_2R),
      delta: null,
    },
    {
      label: 'Profit factor', value: a.profit_factor != null ? a.profit_factor.toFixed(2) : '—',
      delta: null,
    },
  ];
  const el = document.getElementById('sizing-stat-cards');
  el.innerHTML = cards.map(c => {
    let deltaHtml = '';
    if (c.delta != null && baseline && active.id !== baseline.id) {
      let txt;
      if (c.isInt) txt = (c.delta >= 0 ? '+' : '') + c.delta + (c.deltaSuffix || '');
      else if (c.isMoney) txt = (c.delta >= 0 ? '+' : '-') + '$' + Math.abs(c.delta).toLocaleString('en-US', { maximumFractionDigits: 0 });
      else txt = _signed(c.delta, 2, c.deltaSuffix || '');
      deltaHtml = `<div class="sizing-card-delta ${_deltaCls(c.delta)}">${txt} vs base</div>`;
    }
    return `<div class="sizing-card">
      <div class="sizing-card-label">${c.label}</div>
      <div class="sizing-card-value">${c.value}</div>
      ${deltaHtml}
    </div>`;
  }).join('');
}

function renderSizingHeatmap() {
  const wrap = document.getElementById('sizing-heatmap-wrap');
  const host = document.getElementById('sizing-heatmap');
  const legend = document.getElementById('sizing-heatmap-legend');
  if (!wrap || !host) return;

  // Only consider runs with explicit cut_pct (2D mode runs)
  const runs = ((SIZING_RUNS && SIZING_RUNS.runs) || [])
    .filter(r => r.params && r.params.cut_pct != null);
  if (runs.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  // Bin by rounded (sizing, cut). When duplicates exist, keep the best by
  // expectancy_R so the picture matches the run-history "best" highlights.
  const cells = new Map();
  const sSet = new Set();
  const cSet = new Set();
  for (const r of runs) {
    const sv = Math.round(r.params.sizing_pct * 1000) / 1000;
    const cv = Math.round(r.params.cut_pct * 1000) / 1000;
    sSet.add(sv); cSet.add(cv);
    const key = sv + '|' + cv;
    const cur = cells.get(key);
    if (!cur || r.aggregate.expectancy_R > cur.aggregate.expectancy_R) {
      cells.set(key, r);
    }
  }
  const sAxis = Array.from(sSet).sort((a, b) => a - b);
  const cAxis = Array.from(cSet).sort((a, b) => a - b);

  // Determine the metric range
  const metric = sizingHeatmapMetric;
  const vals = Array.from(cells.values())
    .map(r => r.aggregate[metric])
    .filter(v => v != null && !isNaN(v));
  if (vals.length === 0) { host.innerHTML = ''; return; }
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);

  const usesDiverging = (metric === 'expectancy_R' || metric === 'total_pnl');
  function color(v) {
    if (v == null || isNaN(v)) return 'rgba(255,255,255,0.04)';
    if (usesDiverging) {
      const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
      const t = Math.max(-1, Math.min(1, v / m));
      if (t >= 0) {
        const a = 0.10 + 0.55 * t;
        return `rgba(48, 209, 88, ${a.toFixed(3)})`;
      }
      const a = 0.10 + 0.55 * (-t);
      return `rgba(255, 69, 58, ${a.toFixed(3)})`;
    }
    const span = (hi - lo) || 1;
    const t = (v - lo) / span;
    const a = 0.10 + 0.55 * t;
    return `rgba(229, 187, 118, ${a.toFixed(3)})`;
  }

  function fmtCell(v) {
    if (v == null || isNaN(v)) return '—';
    if (metric === 'expectancy_R') return (v >= 0 ? '+' : '') + v.toFixed(2);
    if (metric === 'total_pnl') {
      const k = v / 1000;
      return (k >= 0 ? '+' : '') + k.toFixed(0) + 'k';
    }
    if (metric === 'win_rate') return (v * 100).toFixed(0) + '%';
    if (metric === 'avg_holding_days') return v.toFixed(0) + 'd';
    return v.toString();
  }

  const baseline = sizingBaselineRun();
  const activeId = sizingActiveRunId;

  // Rows = sizing high to low, columns = cut low to high
  const sRows = sAxis.slice().reverse();
  let html = '<table class="sizing-heatmap-table"><thead><tr><th class="sizing-heatmap-corner">size \\ cut</th>';
  for (const cv of cAxis) html += `<th>${cv.toFixed(2)}</th>`;
  html += '</tr></thead><tbody>';
  for (const sv of sRows) {
    html += `<tr><th>${sv.toFixed(2)}</th>`;
    for (const cv of cAxis) {
      const r = cells.get(sv + '|' + cv);
      if (!r) {
        html += '<td class="sizing-heatmap-empty"></td>';
        continue;
      }
      const v = r.aggregate[metric];
      const isActive = r.id === activeId;
      const isBase = baseline && r.id === baseline.id;
      const cls = 'sizing-heatmap-cell'
        + (isActive ? ' sizing-heatmap-active' : '')
        + (isBase ? ' sizing-heatmap-base' : '');
      const tooltip = `s=${sv.toFixed(3)} c=${cv.toFixed(3)}\nexpR ${r.aggregate.expectancy_R.toFixed(3)}\nwin ${(r.aggregate.win_rate*100).toFixed(0)}%\nstops ${r.aggregate.stop_outs}\nhold ${r.aggregate.avg_holding_days.toFixed(1)}d\npnl $${Math.round(r.aggregate.total_pnl).toLocaleString()}`;
      html += `<td class="${cls}" style="background:${color(v)}" title="${tooltip}" data-run-id="${r.id}">${fmtCell(v)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  host.innerHTML = html;

  // Click to load
  host.querySelectorAll('td.sizing-heatmap-cell').forEach(td => {
    td.addEventListener('click', () => {
      sizingActiveRunId = td.dataset.runId;
      renderSizingActiveHeader();
      renderSizingStatCards();
      renderSizingNotable();
      renderSizingHeatmap();
      renderSizingStrategyTable();
      renderSizingHistoryTable();
    });
  });

  if (legend) {
    if (usesDiverging) {
      legend.innerHTML = `
        <span class="sizing-legend-swatch" style="background:rgba(255,69,58,0.65)"></span>
        <span class="sizing-legend-label">${fmtCell(lo)}</span>
        <span class="sizing-legend-swatch" style="background:rgba(255,255,255,0.06)"></span>
        <span class="sizing-legend-label">0</span>
        <span class="sizing-legend-swatch" style="background:rgba(48,209,88,0.65)"></span>
        <span class="sizing-legend-label">${fmtCell(hi)}</span>
      `;
    } else {
      legend.innerHTML = `
        <span class="sizing-legend-swatch" style="background:rgba(229,187,118,0.10)"></span>
        <span class="sizing-legend-label">${fmtCell(lo)}</span>
        <span class="sizing-legend-swatch" style="background:rgba(229,187,118,0.65)"></span>
        <span class="sizing-legend-label">${fmtCell(hi)}</span>
      `;
    }
  }
}

function renderSizingNotable() {
  const active = sizingActiveRun();
  const wrap = document.getElementById('sizing-notable');
  const list = document.getElementById('sizing-notable-list');
  if (!active || !active.notable_shifts || active.notable_shifts.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  list.innerHTML = active.notable_shifts.map(s => `<li>${s}</li>`).join('');
}

function renderSizingStrategyTable() {
  const active = sizingActiveRun();
  const tbody = document.getElementById('sizing-strategy-tbody');
  if (!active) { tbody.innerHTML = ''; return; }
  const rows = (active.per_strategy || []).slice();
  const f = sizingStrategySort.field;
  const dir = sizingStrategySort.dir;
  rows.sort((a, b) => {
    const av = a[f], bv = b[f];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.strategy}</td>
      <td>${r.trades}</td>
      <td>${_fmtR(r.expectancy_R)}</td>
      <td class="${_deltaCls(r.delta_expectancy_R)}">${r.delta_expectancy_R != null ? _signed(r.delta_expectancy_R, 2, 'R') : '—'}</td>
      <td>${_fmtPct(r.win_rate)}</td>
      <td>${_fmtIntOrDash(r.stop_outs)}</td>
      <td class="${_deltaCls(r.delta_stop_outs)}">${r.delta_stop_outs != null ? _signed(r.delta_stop_outs, 0) : '—'}</td>
      <td>${_fmtNumOrDash(r.avg_holding_days, 1)}</td>
      <td class="${_deltaCls(r.delta_avg_holding_days)}">${r.delta_avg_holding_days != null ? _signed(r.delta_avg_holding_days, 1, 'd') : '—'}</td>
      <td>${_fmtMoney(r.total_pnl)}</td>
    </tr>
  `).join('');
}

function renderSizingHistoryTable() {
  const tbody = document.getElementById('sizing-history-tbody');
  let runs = ((SIZING_RUNS && SIZING_RUNS.runs) || []).slice();
  if (runs.length === 0) { tbody.innerHTML = ''; return; }
  if (sizingHistoryDedupe) {
    const seen = new Map();
    for (const r of runs) {
      const ck = r.params.cut_pct == null ? 'hist' : r.params.cut_pct.toFixed(3);
      const key = r.params.sizing_pct.toFixed(3) + '|' + ck;
      const cur = seen.get(key);
      if (!cur || r.aggregate.expectancy_R > cur.aggregate.expectancy_R) {
        seen.set(key, r);
      }
    }
    runs = Array.from(seen.values());
  }
  // Sort
  const f = sizingHistorySort;
  runs.sort((a, b) => {
    if (f === 'sizing_pct') return a.params.sizing_pct - b.params.sizing_pct;
    if (f === 'cut_pct') {
      const av = a.params.cut_pct == null ? -1 : a.params.cut_pct;
      const bv = b.params.cut_pct == null ? -1 : b.params.cut_pct;
      return av - bv;
    }
    if (f === 'timestamp') return (a.timestamp || '').localeCompare(b.timestamp || '');
    return (b.aggregate[f] || 0) - (a.aggregate[f] || 0);
  });

  // Find best for highlighting
  const bestExp = runs.reduce((m, r) => Math.max(m, r.aggregate.expectancy_R), -Infinity);
  const baseline = sizingBaselineRun();

  tbody.innerHTML = runs.map(r => {
    const a = r.aggregate;
    const d = r.deltas_vs_baseline || {};
    const isActive = sizingActiveRunId === r.id;
    const isBest = a.expectancy_R === bestExp;
    const isBase = baseline && r.id === baseline.id;
    let cls = '';
    if (isActive) cls += ' sizing-row-active';
    if (isBest) cls += ' sizing-row-best';
    if (isBase) cls += ' sizing-row-base';
    const cutCell = r.params.cut_pct != null
      ? r.params.cut_pct.toFixed(3)
      : (r.params.mode === 'rescale' ? '<em>n/a</em>' : '<em>hist</em>');
    const mode = r.params.mode || (r.params.cut_pct != null ? 'sim_2d' : 'sim_1d');
    const modeChip = ` <span class="sizing-tag sizing-tag-mode">${_modeLabel(mode)}</span>`;
    const stopsCell = a.stop_outs == null
      ? '—'
      : a.stop_outs + (d.stop_outs != null && !isBase ? ` <span class="sizing-mini ${_deltaCls(d.stop_outs)}">(${_signed(d.stop_outs, 0)})</span>` : '');
    const holdCell = a.avg_holding_days == null
      ? '—'
      : a.avg_holding_days.toFixed(1) + (d.avg_holding_days != null && !isBase ? ` <span class="sizing-mini ${_deltaCls(d.avg_holding_days)}">(${_signed(d.avg_holding_days, 1)})</span>` : '');
    return `<tr class="${cls.trim()}" data-run-id="${r.id}">
      <td>${r.params.sizing_pct.toFixed(3)}${isBase ? ' <span class="sizing-tag sizing-tag-base">base</span>' : ''}${isBest ? ' <span class="sizing-tag sizing-tag-best">best</span>' : ''}${modeChip}</td>
      <td>${cutCell}</td>
      <td>${_fmtR(a.expectancy_R)}</td>
      <td class="${_deltaCls(d.expectancy_R)}">${d.expectancy_R != null && !isBase ? _signed(d.expectancy_R, 2, 'R') : '—'}</td>
      <td>${_fmtPct(a.win_rate)}</td>
      <td>${stopsCell}</td>
      <td>${holdCell}</td>
      <td>${_fmtMoney(a.total_pnl)}</td>
      <td>${_fmtPct(a.tranche_fill_rate_1R)} / ${_fmtPct(a.tranche_fill_rate_2R)}</td>
      <td>${a.avg_shares_per_trade != null ? a.avg_shares_per_trade.toFixed(0) : '—'}</td>
      <td class="sizing-note">${(r.note || '').replace(/</g, '&lt;')}</td>
      <td class="sizing-ts">${(r.timestamp || '').replace('T', ' ').replace('Z', '')}</td>
    </tr>`;
  }).join('');

  // Click to load
  tbody.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      sizingActiveRunId = tr.dataset.runId;
      renderSizingActiveHeader();
      renderSizingStatCards();
      renderSizingNotable();
      renderSizingStrategyTable();
      renderSizingHistoryTable();
    });
  });
}

// ==========================================
// TRADE REPLAY
// ==========================================
// JS port of simulate_sizing.simulate_trade so we can replay any trade
// under any (sizing_pct, cut_pct) at view time without a Python round-trip.

const REPLAY_LOOKAHEAD = 60;
const REPLAY_EMA_PERIOD = 20;

function _replayFindEntryIdx(bars, entryDate) {
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < entryDate) lo = mid + 1;
    else hi = mid;
  }
  return lo < bars.length ? lo : -1;
}

function _replayEMA(closes, period) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n < period) return out;
  const alpha = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    out[i] = alpha * closes[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

// Returns:
//   { ok, pnl, r, holdingDays, exitReason, stopped, tranchesFilled,
//     shares, entry, cut, t1, t2, fills, lastBarDate, scale }
// or { ok:false, reason } if unsimulatable.
function replaySimulateTrade(trade, sizingPct, cutPct) {
  const baseTicker = trade.symbol.split(' ')[0];
  const bars = OHLC[baseTicker];
  if (!bars || bars.length === 0) return { ok: false, reason: 'no OHLC' };
  if (trade.plannedEntry == null || trade.plannedStop == null || trade.riskDollars == null) {
    return { ok: false, reason: 'missing fields' };
  }
  const side = trade.side === 'Buy' ? 1 : -1;
  const entry = +trade.plannedEntry;
  const risk = +trade.riskDollars;
  const deepDist = Math.abs(entry - +trade.plannedStop);
  if (deepDist <= 0 || risk <= 0) return { ok: false, reason: 'bad distance' };

  const cut = (cutPct == null)
    ? +trade.plannedCut
    : entry - side * cutPct * deepDist;
  if (cut == null || isNaN(cut)) return { ok: false, reason: 'no cut' };

  const sd = sizingPct * deepDist;
  if (sd <= 0) return { ok: false, reason: 'bad sizing' };
  const shares = risk / sd;
  const t1 = entry + side * sd;
  const t2 = entry + side * 2 * sd;

  const si = _replayFindEntryIdx(bars, trade.entryDate);
  if (si < 0) return { ok: false, reason: 'entry date not in OHLC' };

  // Scale-correction for split-adjusted bars
  const entryBar = bars[si];
  let scale = 1.0;
  if (entryBar.o && entryBar.o > 0) {
    const ratio = entry / entryBar.o;
    if (ratio < 0.83 || ratio > 1.2) scale = ratio;
  }

  // EMA on a wide window so the value at j is well-seeded
  const calcStart = Math.max(0, si - 80);
  const calcEnd = Math.min(bars.length, si + REPLAY_LOOKAHEAD + 1);
  const closes = [];
  for (let i = calcStart; i < calcEnd; i++) closes.push(bars[i].c);
  const emaArr = _replayEMA(closes, REPLAY_EMA_PERIOD);
  const emaAt = (j) => {
    const localIdx = j - calcStart;
    if (localIdx < 0 || localIdx >= emaArr.length) return null;
    return emaArr[localIdx];
  };

  let state = 'open';
  let realized = 0;
  let exitDate = trade.entryDate;
  let exitReason = 'time-out';
  let tranches = 0;
  const fills = [];
  let lastIdx = si;

  const end = Math.min(si + REPLAY_LOOKAHEAD, bars.length);
  for (let j = si; j < end; j++) {
    const b = bars[j];
    const h = b.h * scale;
    const l = b.l * scale;
    const c = b.c * scale;
    lastIdx = j;

    if (state === 'after_2R') {
      // Trail mode — stop still applies, then 20EMA close exit
      const stopHit = side > 0 ? l <= cut : h >= cut;
      if (stopHit) {
        const remain = shares * 0.25;
        realized += side * (cut - entry) * remain;
        fills.push({ date: b.t, price: cut, qty: remain, label: 'STOP (trail)', kind: 'stop' });
        state = 'closed';
        exitDate = b.t;
        exitReason = 'stop_in_trail';
        break;
      }
      const ema = emaAt(j);
      if (ema != null) {
        const e = ema * scale;
        const exited = side > 0 ? c < e : c > e;
        if (exited) {
          const remain = shares * 0.25;
          realized += side * (c - entry) * remain;
          fills.push({ date: b.t, price: c, qty: remain, label: 'Trail @ 20EMA', kind: 'trail' });
          state = 'closed';
          exitDate = b.t;
          exitReason = 'trail_ema20';
          break;
        }
      }
      continue;
    }

    // Stop check (conservative)
    const stopHit = side > 0 ? l <= cut : h >= cut;
    if (stopHit) {
      const remain = state === 'open' ? shares : shares * 0.5;
      realized += side * (cut - entry) * remain;
      fills.push({ date: b.t, price: cut, qty: remain, label: 'STOP', kind: 'stop' });
      state = 'closed';
      exitDate = b.t;
      exitReason = 'stop';
      break;
    }

    // 1R fill
    if (state === 'open') {
      const hit1 = side > 0 ? h >= t1 : l <= t1;
      if (hit1) {
        const qty1 = shares * 0.5;
        realized += side * (t1 - entry) * qty1;
        fills.push({ date: b.t, price: t1, qty: qty1, label: '1/2 @ +1R', kind: 't1' });
        state = 'after_1R';
        tranches = 1;
      }
    }
    // 2R fill (same bar permitted)
    if (state === 'after_1R') {
      const hit2 = side > 0 ? h >= t2 : l <= t2;
      if (hit2) {
        const qty2 = shares * 0.25;
        realized += side * (t2 - entry) * qty2;
        fills.push({ date: b.t, price: t2, qty: qty2, label: '1/4 @ +2R', kind: 't2' });
        state = 'after_2R';
        tranches = 2;
      }
    }
  }

  // Time-out force close
  if (state !== 'closed') {
    const bar = bars[lastIdx];
    const lastClose = bar.c * scale;
    let remain;
    if (state === 'open') remain = shares;
    else if (state === 'after_1R') remain = shares * 0.5;
    else remain = shares * 0.25;
    realized += side * (lastClose - entry) * remain;
    fills.push({ date: bar.t, price: lastClose, qty: remain, label: 'Time-out close', kind: 'timeout' });
    exitDate = bar.t;
    exitReason = 'time-out';
  }

  // Holding days (calendar)
  let holdingDays = 0;
  try {
    const d0 = new Date(trade.entryDate + 'T00:00:00Z').getTime();
    const d1 = new Date(exitDate + 'T00:00:00Z').getTime();
    holdingDays = Math.max(0, Math.round((d1 - d0) / 86400000));
  } catch (e) { holdingDays = 0; }

  return {
    ok: true,
    pnl: realized,
    r: realized / risk,
    holdingDays,
    exitReason,
    stopped: exitReason === 'stop' || exitReason === 'stop_in_trail',
    tranchesFilled: tranches,
    shares,
    entry,
    cut,
    t1,
    t2,
    fills,
    lastBarDate: exitDate,
    scale,
    side,
  };
}

// Pure rescale: keep real entries, exits, holding period; only compute new
// share count for the given sizing_pct and rescale realized P&L. Mirrors the
// Python simulate_trade_rescale.
function replaySimulateRescale(trade, sizingPct) {
  if (trade.plannedEntry == null || trade.plannedStop == null
      || trade.riskDollars == null || !trade.qty || trade.pnl == null) {
    return { ok: false, reason: 'missing fields' };
  }
  const side = trade.side === 'Buy' ? 1 : -1;
  const entry = +trade.plannedEntry;
  const risk = +trade.riskDollars;
  const deepDist = Math.abs(entry - +trade.plannedStop);
  if (deepDist <= 0 || risk <= 0) return { ok: false, reason: 'bad distance' };
  const sd = sizingPct * deepDist;
  if (sd <= 0) return { ok: false, reason: 'bad sizing' };
  const newShares = risk / sd;
  const perSharePnl = (+trade.pnl) / (+trade.qty);
  const newPnl = perSharePnl * newShares;

  let holdingDays = 0;
  try {
    const d0 = new Date(trade.entryDate + 'T00:00:00Z').getTime();
    const d1 = new Date(trade.exitDate + 'T00:00:00Z').getTime();
    holdingDays = Math.max(0, Math.round((d1 - d0) / 86400000));
  } catch (e) {}

  return {
    ok: true,
    mode: 'rescale',
    pnl: newPnl,
    r: newPnl / risk,
    holdingDays,
    exitReason: 'real exit',
    stopped: false,
    tranchesFilled: 0,
    shares: newShares,
    entry,
    cut: trade.plannedCut != null ? +trade.plannedCut : null,
    t1: entry + side * sd,
    t2: entry + side * 2 * sd,
    fills: [],
    side,
    scale: 1.0,
    lastBarDate: trade.exitDate,
  };
}

function _runMode(run) {
  if (!run || !run.params) return 'sim_1d';
  return run.params.mode || (run.params.cut_pct != null ? 'sim_2d' : 'sim_1d');
}

function _replayCacheKey(tradeId, run) {
  return tradeId + '|' + _runMode(run) + '|' + (run.params.sizing_pct || 0).toFixed(4)
    + '|' + (run.params.cut_pct == null ? 'h' : run.params.cut_pct.toFixed(4));
}

function replayMemoSimulate(trade, run) {
  if (!run) return { ok: false, reason: 'no scenario' };
  const k = _replayCacheKey(trade.tradeId, run);
  if (replaySimCache.has(k)) return replaySimCache.get(k);
  const mode = _runMode(run);
  let res;
  if (mode === 'rescale') {
    res = replaySimulateRescale(trade, run.params.sizing_pct);
  } else {
    res = replaySimulateTrade(trade, run.params.sizing_pct, run.params.cut_pct);
  }
  replaySimCache.set(k, res);
  return res;
}

// Picks the variant run for the right side. Preference order:
//   1. Whatever the user has selected in Sizing Lab (sizingActiveRunId)
//   2. The run with the highest expectancy in the file
//   3. null if no runs
function _findReplayVariantRun() {
  const runs = (SIZING_RUNS && SIZING_RUNS.runs) || [];
  if (runs.length === 0) return null;
  if (sizingActiveRunId) {
    const found = runs.find(r => r.id === sizingActiveRunId);
    if (found) return found;
  }
  let best = null;
  for (const r of runs) {
    if (best == null || r.aggregate.expectancy_R > best.aggregate.expectancy_R) best = r;
  }
  return best;
}

function setupTradeReplay() {
  // Build the replayable trade list from data.json
  if (!DATA || !DATA.regimeTrades || !DATA.regimeTrades.regime8) return;
  REPLAY_TRADES = DATA.regimeTrades.regime8.filter(t =>
    t.plannedEntry != null && t.plannedStop != null && t.plannedCut != null
    && t.riskDollars != null && OHLC[t.symbol.split(' ')[0]]
  ).sort((a, b) => (a.entryDate || '').localeCompare(b.entryDate || ''));

  // Populate strategy filter dropdown
  const stratSel = document.getElementById('replay-strategy');
  if (stratSel) {
    const seen = new Set();
    for (const t of REPLAY_TRADES) seen.add(t.primaryStrategy || '(none)');
    const opts = ['<option value="all">All</option>']
      .concat(Array.from(seen).sort().map(s => `<option value="${s}">${s}</option>`));
    stratSel.innerHTML = opts.join('');
    stratSel.addEventListener('change', () => { replayApplyFilters(); replayIndex = 0; renderTradeReplay(); });
  }
  const outSel = document.getElementById('replay-outcome');
  if (outSel) outSel.addEventListener('change', () => { replayApplyFilters(); replayIndex = 0; renderTradeReplay(); });
  const search = document.getElementById('replay-search');
  if (search) search.addEventListener('input', () => { replayApplyFilters(); replayIndex = 0; renderTradeReplay(); });

  document.getElementById('replay-prev').addEventListener('click', () => {
    if (!REPLAY_FILTERED || REPLAY_FILTERED.length === 0) return;
    replayIndex = (replayIndex - 1 + REPLAY_FILTERED.length) % REPLAY_FILTERED.length;
    renderTradeReplay();
  });
  document.getElementById('replay-next').addEventListener('click', () => {
    if (!REPLAY_FILTERED || REPLAY_FILTERED.length === 0) return;
    replayIndex = (replayIndex + 1) % REPLAY_FILTERED.length;
    renderTradeReplay();
  });

  // Keyboard navigation while on the replay tab
  document.addEventListener('keydown', (e) => {
    if (currentView !== 'replay') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.key === 'ArrowLeft') document.getElementById('replay-prev').click();
    if (e.key === 'ArrowRight') document.getElementById('replay-next').click();
  });

  // Scenario dropdown — wired once, refreshed each render.
  const scenarioSel = document.getElementById('replay-scenario');
  if (scenarioSel) {
    scenarioSel.addEventListener('change', () => {
      sizingActiveRunId = scenarioSel.value || null;
      replayBestRun = _findReplayVariantRun();
      replayApplyFilters();
      replayIndex = 0;
      renderTradeReplay();
    });
  }

  replayBestRun = _findReplayVariantRun();
  replayApplyFilters();

  const badge = document.getElementById('replay-badge');
  if (badge && REPLAY_TRADES) {
    badge.textContent = REPLAY_TRADES.length;
    badge.style.display = '';
  }
}

function _populateReplayScenarioDropdown() {
  const sel = document.getElementById('replay-scenario');
  if (!sel) return;
  const runs = ((SIZING_RUNS && SIZING_RUNS.runs) || []).slice();
  if (runs.length === 0) {
    sel.innerHTML = '<option value="">(no scenarios)</option>';
    return;
  }
  // Sort: best expectancy first, baseline pinned at top
  runs.sort((a, b) => {
    if (a.is_baseline && !b.is_baseline) return -1;
    if (!a.is_baseline && b.is_baseline) return 1;
    return (b.aggregate.expectancy_R || 0) - (a.aggregate.expectancy_R || 0);
  });
  const active = replayBestRun;
  sel.innerHTML = runs.map(r => {
    const mode = _runMode(r);
    const modeShort = mode === 'rescale' ? 'rescale' : (mode === 'sim_2d' ? '2D' : '1D');
    const sP = r.params.sizing_pct.toFixed(3);
    const cP = r.params.cut_pct != null ? ` c=${r.params.cut_pct.toFixed(3)}` : '';
    const exp = (r.aggregate.expectancy_R >= 0 ? '+' : '') + r.aggregate.expectancy_R.toFixed(2);
    const tag = r.is_baseline ? ' [base]' : '';
    const sel_attr = (active && r.id === active.id) ? ' selected' : '';
    return `<option value="${r.id}"${sel_attr}>${modeShort}  s=${sP}${cP}  ${exp}R${tag}</option>`;
  }).join('');
}

function replayApplyFilters() {
  if (!REPLAY_TRADES) { REPLAY_FILTERED = []; return; }
  const stratSel = document.getElementById('replay-strategy');
  const outSel = document.getElementById('replay-outcome');
  const search = document.getElementById('replay-search');
  const strat = stratSel ? stratSel.value : 'all';
  const outcome = outSel ? outSel.value : 'all';
  const q = (search ? search.value : '').trim().toUpperCase();

  const variant = replayBestRun;

  REPLAY_FILTERED = REPLAY_TRADES.filter(t => {
    if (strat !== 'all' && (t.primaryStrategy || '(none)') !== strat) return false;
    if (q && !t.symbol.toUpperCase().includes(q)) return false;
    if (outcome === 'all') return true;

    const actualPnl = +t.pnl || 0;
    if (outcome === 'actual_winner') return actualPnl > 0;
    if (outcome === 'actual_loser') return actualPnl <= 0;

    if (variant == null) return false;
    const vari = replayMemoSimulate(t, variant);
    if (!vari.ok) return false;
    if (outcome === 'variant_winner') return vari.pnl > 0;
    if (outcome === 'variant_stopped') return vari.stopped;
    if (outcome === 'improved') return vari.pnl > actualPnl + 1;
    if (outcome === 'hurt') return vari.pnl < actualPnl - 1;
    return true;
  });
}

function renderTradeReplay() {
  const empty = document.getElementById('replay-empty');
  const content = document.getElementById('replay-content');
  // Always re-pick the variant — the user may have selected a new row in Sizing Lab
  replayBestRun = _findReplayVariantRun();
  _populateReplayScenarioDropdown();
  if (!replayBestRun || !REPLAY_TRADES || REPLAY_TRADES.length === 0) {
    if (empty) empty.style.display = '';
    if (content) content.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (content) content.style.display = '';

  const variant = replayBestRun;
  const sP = variant.params.sizing_pct;
  const cP = variant.params.cut_pct;
  const mode = _runMode(variant);

  let scenarioDesc;
  if (mode === 'rescale') {
    scenarioDesc = `<strong>rescale @ sizing ${sP.toFixed(3)}</strong> (real entries &amp; exits, share count rescaled)`;
  } else if (mode === 'sim_2d') {
    scenarioDesc = `<strong>2D sim @ sizing ${sP.toFixed(3)} &middot; cut ${cP.toFixed(3)}</strong> (rule-based exits)`;
  } else {
    scenarioDesc = `<strong>1D sim @ sizing ${sP.toFixed(3)}</strong> (rule-based exits, historical cut)`;
  }
  const expR = variant.aggregate.expectancy_R;
  document.getElementById('replay-config-summary').innerHTML =
    `Right side: ${scenarioDesc} &mdash; fund expectancy ${expR >= 0 ? '+' : ''}${expR.toFixed(3)}R`;

  const subLine = mode === 'rescale'
    ? `rescale &middot; size ${sP.toFixed(3)}`
    : (mode === 'sim_2d'
      ? `sim 2D &middot; size ${sP.toFixed(3)} &middot; cut ${cP.toFixed(3)}`
      : `sim 1D &middot; size ${sP.toFixed(3)} &middot; hist cut`);
  document.getElementById('replay-var-config').innerHTML = subLine;

  if (!REPLAY_FILTERED || REPLAY_FILTERED.length === 0) {
    document.getElementById('replay-position').textContent = '0 / 0';
    document.getElementById('replay-trade-meta').innerHTML = '<div class="replay-no-trades">No trades match the current filters.</div>';
    document.getElementById('replay-orig-stats').innerHTML = '';
    document.getElementById('replay-var-stats').innerHTML = '';
    document.getElementById('replay-chart-orig').innerHTML = '';
    document.getElementById('replay-chart-var').innerHTML = '';
    return;
  }

  if (replayIndex >= REPLAY_FILTERED.length) replayIndex = 0;
  const trade = REPLAY_FILTERED[replayIndex];
  document.getElementById('replay-position').textContent = `${replayIndex + 1} / ${REPLAY_FILTERED.length}`;

  // Trade meta line
  const isWin = trade.pnl >= 0;
  document.getElementById('replay-trade-meta').innerHTML = `
    <span class="replay-meta-symbol">${trade.symbol}</span>
    <span class="replay-meta-item">${trade.entryDate} &rarr; ${trade.exitDate}</span>
    <span class="replay-meta-item">${trade.side}</span>
    ${trade.primaryStrategy ? `<span class="replay-meta-item"><span class="strategy-badge ${strategyClass(trade.primaryStrategy)}">${strategyLabel(trade.primaryStrategy)}</span></span>` : ''}
    <span class="replay-meta-item">Risk: $${(trade.riskDollars || 0).toLocaleString()}</span>
    <span class="replay-meta-item">Sized @ $${trade.plannedEntry.toFixed(2)}</span>
    <span class="replay-meta-item">Deep stop $${trade.plannedStop.toFixed(2)}</span>
    <span class="replay-meta-item">Historical cut $${trade.plannedCut.toFixed(2)}</span>
    <span class="replay-meta-item ${isWin ? 'positive' : 'negative'}">Actual P&L: ${fmtPnL(trade.pnl)}</span>
    ${trade.rMultiple != null ? `<span class="replay-meta-item ${trade.rMultiple >= 0 ? 'positive' : 'negative'}">Actual R: ${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}</span>` : ''}
  `;

  const varSim = replayMemoSimulate(trade, variant);

  document.getElementById('replay-orig-stats').innerHTML = _replayActualStatsHtml(trade);
  document.getElementById('replay-var-stats').innerHTML = _replayStatsHtml(varSim, trade);

  _replayRenderActualChart('replay-chart-orig', trade);
  if (mode === 'rescale') {
    _replayRenderRescaleChart('replay-chart-var', trade, varSim);
  } else {
    _replayRenderChart('replay-chart-var', 'var', trade, varSim);
  }
}

function _replayActualStatsHtml(trade) {
  const pnl = +trade.pnl || 0;
  const cls = pnl >= 0 ? 'positive' : 'negative';
  let holding = 0;
  try {
    const d0 = new Date(trade.entryDate + 'T00:00:00Z').getTime();
    const d1 = new Date(trade.exitDate + 'T00:00:00Z').getTime();
    holding = Math.max(0, Math.round((d1 - d0) / 86400000));
  } catch (e) { holding = 0; }
  const rTxt = trade.rMultiple != null
    ? `<span class="replay-stat ${trade.rMultiple >= 0 ? 'positive' : 'negative'}">${trade.rMultiple >= 0 ? '+' : ''}${trade.rMultiple.toFixed(2)}R</span>`
    : '';
  const qty = trade.qty != null ? Math.round(+trade.qty).toLocaleString() : '?';
  const exitPx = trade.exit != null ? `$${(+trade.exit).toFixed(2)}` : '?';
  return `
    ${rTxt}
    <span class="replay-stat ${cls}">${fmtPnL(pnl)}</span>
    <span class="replay-stat">${qty} sh</span>
    <span class="replay-stat">${holding}d hold</span>
    <span class="replay-stat replay-stat-reason">exit ${exitPx}</span>
  `;
}

function _replayRenderActualChart(containerId, trade) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';

  const baseTicker = trade.symbol.split(' ')[0];
  const tickerData = OHLC[baseTicker];
  if (!tickerData || tickerData.length === 0) {
    container.innerHTML = '<div class="replay-no-data">No OHLC for ' + baseTicker + '</div>';
    return;
  }

  const entryIdx = tickerData.findIndex(d => d.t >= trade.entryDate);
  if (entryIdx < 0) {
    container.innerHTML = '<div class="replay-no-data">Entry date not in OHLC</div>';
    return;
  }
  let exitIdx = tickerData.findIndex(d => d.t >= trade.exitDate);
  if (exitIdx < 0) exitIdx = tickerData.length - 1;

  const padBefore = 30;
  const padAfter = 20;
  const start = Math.max(0, entryIdx - padBefore);
  const end = Math.min(tickerData.length, exitIdx + padAfter + 1);
  const slice = tickerData.slice(start, end);

  // Detect split-adjusted bars and rescale to match the planned/actual price scale.
  // We anchor on plannedEntry vs the entry-day open (same heuristic as the simulator).
  let scale = 1.0;
  const entryBar = tickerData[entryIdx];
  if (trade.plannedEntry != null && entryBar && entryBar.o > 0) {
    const ratio = +trade.plannedEntry / entryBar.o;
    if (ratio < 0.83 || ratio > 1.2) scale = ratio;
  }

  const candleData = slice.map(d => ({
    time: d.t,
    open: d.o * scale,
    high: d.h * scale,
    low: d.l * scale,
    close: d.c * scale,
  }));

  const chart = LightweightCharts.createChart(container, {
    ...CHART_OPTS,
    rightPriceScale: { borderColor: 'rgba(229, 187, 118, 0.2)', scaleMargins: { top: 0.1, bottom: 0.1 } },
  });

  const candles = chart.addCandlestickSeries({
    upColor: '#30d158', downColor: '#ff453a',
    borderUpColor: '#30d158', borderDownColor: '#ff453a',
    wickUpColor: '#30d158', wickDownColor: '#ff453a',
  });
  candles.setData(candleData);

  // 20EMA reference line
  const closes = candleData.map(d => d.close);
  const emaArr = _replayEMA(closes, 20);
  const emaData = [];
  for (let i = 0; i < emaArr.length; i++) {
    if (emaArr[i] != null) emaData.push({ time: candleData[i].time, value: emaArr[i] });
  }
  if (emaData.length > 0) {
    const emaSeries = chart.addLineSeries({
      color: 'rgba(229, 187, 118, 0.7)',
      lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: '20EMA',
    });
    emaSeries.setData(emaData);
  }

  // Horizontal reference lines: planned entry, planned cut, deep stop,
  // and the original (size-deeply) 1R/2R targets.
  if (trade.plannedEntry != null) {
    candles.createPriceLine({
      price: +trade.plannedEntry, color: '#e5bb76', lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true, title: 'Planned entry',
    });
  }
  if (trade.plannedCut != null) {
    candles.createPriceLine({
      price: +trade.plannedCut, color: '#ff453a', lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true, title: 'Planned cut',
    });
  }
  if (trade.plannedStop != null) {
    candles.createPriceLine({
      price: +trade.plannedStop, color: 'rgba(255, 69, 58, 0.55)', lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true, title: 'Deep stop',
    });
  }
  if (trade.plannedEntry != null && trade.plannedStop != null) {
    const side = trade.side === 'Buy' ? 1 : -1;
    const deepDist = Math.abs(+trade.plannedEntry - +trade.plannedStop);
    if (deepDist > 0) {
      const t1 = +trade.plannedEntry + side * deepDist;
      const t2 = +trade.plannedEntry + side * 2 * deepDist;
      candles.createPriceLine({
        price: t1, color: '#30d158', lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true, title: '+1R (planned)',
      });
      candles.createPriceLine({
        price: t2, color: '#5ee37f', lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true, title: '+2R (planned)',
      });
    }
  }

  // Real entry and exit markers from the trade's leg arrays
  const snap = (date) => {
    for (let i = 0; i < candleData.length; i++) if (candleData[i].time >= date) return candleData[i].time;
    return candleData[candleData.length - 1].time;
  };
  const isWin = (+trade.pnl || 0) >= 0;
  const entryLegs = Array.isArray(trade.entryLegs) && trade.entryLegs.length ? trade.entryLegs : null;
  const exitLegs = Array.isArray(trade.exitLegs) && trade.exitLegs.length ? trade.exitLegs : null;

  const markers = [];
  if (entryLegs) {
    for (const leg of entryLegs) {
      markers.push({
        time: snap(leg.date),
        position: 'belowBar', color: '#e5bb76', shape: 'arrowUp',
        text: `Entry $${(+leg.price).toFixed(2)}`,
      });
    }
  } else {
    markers.push({
      time: snap(trade.entryDate),
      position: 'belowBar', color: '#e5bb76', shape: 'arrowUp',
      text: `Entry $${(+trade.entry || 0).toFixed(2)}`,
    });
  }
  if (exitLegs) {
    for (const leg of exitLegs) {
      markers.push({
        time: snap(leg.date),
        position: 'aboveBar',
        color: isWin ? '#30d158' : '#ff453a',
        shape: 'arrowDown',
        text: `Exit $${(+leg.price).toFixed(2)}`,
      });
    }
  } else {
    markers.push({
      time: snap(trade.exitDate),
      position: 'aboveBar',
      color: isWin ? '#30d158' : '#ff453a',
      shape: 'arrowDown',
      text: `Exit $${(+trade.exit || 0).toFixed(2)}`,
    });
  }
  markers.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  candles.setMarkers(markers);

  chart.timeScale().fitContent();
  replayChartOrig = chart;
}

function _replayRenderRescaleChart(containerId, trade, sim) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!sim || !sim.ok) {
    container.innerHTML = `<div class="replay-no-data">${sim ? sim.reason : 'no simulation'}</div>`;
    return;
  }

  const baseTicker = trade.symbol.split(' ')[0];
  const tickerData = OHLC[baseTicker];
  if (!tickerData || tickerData.length === 0) {
    container.innerHTML = '<div class="replay-no-data">No OHLC for ' + baseTicker + '</div>';
    return;
  }

  const entryIdx = tickerData.findIndex(d => d.t >= trade.entryDate);
  if (entryIdx < 0) {
    container.innerHTML = '<div class="replay-no-data">Entry date not in OHLC</div>';
    return;
  }
  let exitIdx = tickerData.findIndex(d => d.t >= trade.exitDate);
  if (exitIdx < 0) exitIdx = tickerData.length - 1;

  const padBefore = 30;
  const padAfter = 20;
  const start = Math.max(0, entryIdx - padBefore);
  const end = Math.min(tickerData.length, exitIdx + padAfter + 1);
  const slice = tickerData.slice(start, end);

  // Match the actual-chart's scale-correction so price lines line up
  let scale = 1.0;
  const entryBar = tickerData[entryIdx];
  if (trade.plannedEntry != null && entryBar && entryBar.o > 0) {
    const ratio = +trade.plannedEntry / entryBar.o;
    if (ratio < 0.83 || ratio > 1.2) scale = ratio;
  }

  const candleData = slice.map(d => ({
    time: d.t,
    open: d.o * scale,
    high: d.h * scale,
    low: d.l * scale,
    close: d.c * scale,
  }));

  const chart = LightweightCharts.createChart(container, {
    ...CHART_OPTS,
    rightPriceScale: { borderColor: 'rgba(229, 187, 118, 0.2)', scaleMargins: { top: 0.1, bottom: 0.1 } },
  });

  const candles = chart.addCandlestickSeries({
    upColor: '#30d158', downColor: '#ff453a',
    borderUpColor: '#30d158', borderDownColor: '#ff453a',
    wickUpColor: '#30d158', wickDownColor: '#ff453a',
  });
  candles.setData(candleData);

  // 20EMA reference
  const closes = candleData.map(d => d.close);
  const emaArr = _replayEMA(closes, 20);
  const emaData = [];
  for (let i = 0; i < emaArr.length; i++) {
    if (emaArr[i] != null) emaData.push({ time: candleData[i].time, value: emaArr[i] });
  }
  if (emaData.length > 0) {
    const emaSeries = chart.addLineSeries({
      color: 'rgba(229, 187, 118, 0.7)',
      lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: '20EMA',
    });
    emaSeries.setData(emaData);
  }

  // Horizontal lines: planned entry, planned cut, deep stop, RESCALED 1R/2R
  candles.createPriceLine({
    price: sim.entry, color: '#e5bb76', lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true, title: 'Entry',
  });
  if (sim.cut != null) {
    candles.createPriceLine({
      price: sim.cut, color: '#ff453a', lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Solid,
      axisLabelVisible: true, title: 'Cut',
    });
  }
  if (trade.plannedStop != null) {
    candles.createPriceLine({
      price: +trade.plannedStop, color: 'rgba(255, 69, 58, 0.55)', lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true, title: 'Deep stop',
    });
  }
  candles.createPriceLine({
    price: sim.t1, color: '#30d158', lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true, title: '+1R (rescaled)',
  });
  candles.createPriceLine({
    price: sim.t2, color: '#5ee37f', lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true, title: '+2R (rescaled)',
  });

  // Real entry/exit markers (rescale uses real exits)
  const snap = (date) => {
    for (let i = 0; i < candleData.length; i++) if (candleData[i].time >= date) return candleData[i].time;
    return candleData[candleData.length - 1].time;
  };
  const isWin = sim.pnl >= 0;
  const entryLegs = Array.isArray(trade.entryLegs) && trade.entryLegs.length ? trade.entryLegs : null;
  const exitLegs = Array.isArray(trade.exitLegs) && trade.exitLegs.length ? trade.exitLegs : null;

  const markers = [];
  if (entryLegs) {
    for (const leg of entryLegs) {
      markers.push({
        time: snap(leg.date),
        position: 'belowBar', color: '#e5bb76', shape: 'arrowUp',
        text: `Entry $${(+leg.price).toFixed(2)}`,
      });
    }
  } else {
    markers.push({
      time: snap(trade.entryDate),
      position: 'belowBar', color: '#e5bb76', shape: 'arrowUp',
      text: `Entry $${(+trade.entry || 0).toFixed(2)}`,
    });
  }
  if (exitLegs) {
    for (const leg of exitLegs) {
      markers.push({
        time: snap(leg.date),
        position: 'aboveBar',
        color: isWin ? '#30d158' : '#ff453a',
        shape: 'arrowDown',
        text: `Exit $${(+leg.price).toFixed(2)}`,
      });
    }
  } else {
    markers.push({
      time: snap(trade.exitDate),
      position: 'aboveBar',
      color: isWin ? '#30d158' : '#ff453a',
      shape: 'arrowDown',
      text: `Exit $${(+trade.exit || 0).toFixed(2)}`,
    });
  }
  markers.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  candles.setMarkers(markers);

  chart.timeScale().fitContent();
  replayChartVar = chart;
}

function _replayStatsHtml(sim, trade) {
  if (!sim || !sim.ok) return `<div class="replay-stat-bad">Could not simulate (${sim ? sim.reason : 'unknown'})</div>`;
  const r = sim.r;
  const cls = r >= 0 ? 'positive' : 'negative';
  const reasonLabels = {
    stop: 'Hard stop',
    stop_in_trail: 'Stop in trail',
    trail_ema20: 'Trail @ 20EMA',
    'time-out': 'Time-out',
    'real exit': 'Real exit (rescaled)',
  };
  return `
    <span class="replay-stat ${cls}">${r >= 0 ? '+' : ''}${r.toFixed(2)}R</span>
    <span class="replay-stat ${cls}">${fmtPnL(sim.pnl)}</span>
    <span class="replay-stat">${Math.round(sim.shares).toLocaleString()} sh</span>
    <span class="replay-stat">${sim.holdingDays}d hold</span>
    <span class="replay-stat replay-stat-reason">${reasonLabels[sim.exitReason] || sim.exitReason}</span>
  `;
}

function _replayRenderChart(containerId, side, trade, sim) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!sim || !sim.ok) {
    container.innerHTML = `<div class="replay-no-data">${sim ? sim.reason : 'no simulation'}</div>`;
    return;
  }

  const baseTicker = trade.symbol.split(' ')[0];
  const tickerData = OHLC[baseTicker];
  if (!tickerData || tickerData.length === 0) {
    container.innerHTML = '<div class="replay-no-data">No OHLC for ' + baseTicker + '</div>';
    return;
  }

  const entryIdx = tickerData.findIndex(d => d.t >= trade.entryDate);
  if (entryIdx < 0) {
    container.innerHTML = '<div class="replay-no-data">Entry date not in OHLC</div>';
    return;
  }
  let exitIdx = tickerData.findIndex(d => d.t >= sim.lastBarDate);
  if (exitIdx < 0) exitIdx = tickerData.length - 1;

  const padBefore = 30;
  const padAfter = 20;
  const start = Math.max(0, entryIdx - padBefore);
  const end = Math.min(tickerData.length, exitIdx + padAfter + 1);
  const slice = tickerData.slice(start, end);

  // Apply scale-correction to displayed bars so price-line levels line up visually
  const scale = sim.scale || 1.0;
  const candleData = slice.map(d => ({
    time: d.t,
    open: d.o * scale,
    high: d.h * scale,
    low: d.l * scale,
    close: d.c * scale,
  }));

  const chart = LightweightCharts.createChart(container, {
    ...CHART_OPTS,
    rightPriceScale: { borderColor: 'rgba(229, 187, 118, 0.2)', scaleMargins: { top: 0.1, bottom: 0.1 } },
  });

  const candles = chart.addCandlestickSeries({
    upColor: '#30d158', downColor: '#ff453a',
    borderUpColor: '#30d158', borderDownColor: '#ff453a',
    wickUpColor: '#30d158', wickDownColor: '#ff453a',
  });
  candles.setData(candleData);

  // 20-day EMA on the displayed slice (matches what the simulator's trail uses)
  const closes = candleData.map(d => d.close);
  const emaArr = _replayEMA(closes, 20);
  const emaData = [];
  for (let i = 0; i < emaArr.length; i++) {
    if (emaArr[i] != null) emaData.push({ time: candleData[i].time, value: emaArr[i] });
  }
  if (emaData.length > 0) {
    const emaSeries = chart.addLineSeries({
      color: 'rgba(229, 187, 118, 0.7)',
      lineWidth: 1,
      priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
      title: '20EMA',
    });
    emaSeries.setData(emaData);
  }

  // Horizontal price lines:
  //   Entry (gold), Hard cut (red, solid), Deep stop reference (red, dashed),
  //   1R target (green), 2R target (bright green)
  candles.createPriceLine({
    price: sim.entry, color: '#e5bb76', lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true, title: 'Entry',
  });
  candles.createPriceLine({
    price: sim.cut, color: '#ff453a', lineWidth: 2,
    lineStyle: LightweightCharts.LineStyle.Solid,
    axisLabelVisible: true, title: 'Cut',
  });
  // Deep stop reference is the same on both charts (the structural deep stop)
  candles.createPriceLine({
    price: +trade.plannedStop, color: 'rgba(255, 69, 58, 0.55)', lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true, title: 'Deep stop',
  });
  candles.createPriceLine({
    price: sim.t1, color: '#30d158', lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true, title: '+1R',
  });
  candles.createPriceLine({
    price: sim.t2, color: '#5ee37f', lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true, title: '+2R',
  });

  // Markers: entry arrow + every fill from the simulator
  const snap = (date) => {
    for (let i = 0; i < candleData.length; i++) if (candleData[i].time >= date) return candleData[i].time;
    return candleData[candleData.length - 1].time;
  };
  const markers = [];
  markers.push({
    time: snap(trade.entryDate),
    position: 'belowBar', color: '#e5bb76', shape: 'arrowUp',
    text: `Entry $${sim.entry.toFixed(2)}`,
  });
  for (const f of sim.fills) {
    let color = '#e5bb76';
    if (f.kind === 't1') color = '#30d158';
    if (f.kind === 't2') color = '#5ee37f';
    if (f.kind === 'stop') color = '#ff453a';
    if (f.kind === 'trail') color = '#e5bb76';
    if (f.kind === 'timeout') color = 'rgba(255,255,255,0.6)';
    markers.push({
      time: snap(f.date),
      position: 'aboveBar',
      color,
      shape: f.kind === 'stop' ? 'arrowDown' : 'arrowDown',
      text: f.label,
    });
  }
  markers.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  candles.setMarkers(markers);

  chart.timeScale().fitContent();

  // Track for resize
  if (side === 'orig') replayChartOrig = chart;
  else replayChartVar = chart;
}

// --- Resize Handling ---
window.addEventListener('resize', () => {
  if (equityChart) equityChart.applyOptions({ width: document.getElementById('equity-chart').clientWidth });
  if (drawdownChart) drawdownChart.applyOptions({ width: document.getElementById('drawdown-chart').clientWidth });
  if (tradeChart) tradeChart.applyOptions({ width: document.getElementById('trade-chart').clientWidth });
  if (macdChart) macdChart.applyOptions({ width: document.getElementById('macd-chart').clientWidth });
  if (replayChartOrig) {
    const el = document.getElementById('replay-chart-orig');
    if (el) replayChartOrig.applyOptions({ width: el.clientWidth });
  }
  if (replayChartVar) {
    const el = document.getElementById('replay-chart-var');
    if (el) replayChartVar.applyOptions({ width: el.clientWidth });
  }
});

new ResizeObserver(() => {
  if (equityChart) equityChart.applyOptions({ width: document.getElementById('equity-chart').clientWidth });
}).observe(document.getElementById('equity-chart'));

new ResizeObserver(() => {
  if (drawdownChart) drawdownChart.applyOptions({ width: document.getElementById('drawdown-chart').clientWidth });
}).observe(document.getElementById('drawdown-chart'));

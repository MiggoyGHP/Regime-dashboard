// ==========================================
// REGIME PERFORMANCE DASHBOARD
// Application Logic
// ==========================================

// --- State ---
let DATA = null;
let OHLC = null;
let currentRegime = 1;
let currentView = 'overview';
let currentColorFilter = 'all';
let selectedTradeIdx = null;
let equityChart, equityLineSeries, equityBandSeries = {};
let drawdownBandSeries = {};
let equityColorState = { Green: true, Yellow: true, Red: true };
let overlayState = { equity: true, spx: false, vix: false, mmth: false };
let overlaySeries = {};
let drawdownChart, drawdownSeries;
let tradeChart, tradeSeries, macdChart;
let tradeRegimeBandSeries = {};
let tradeRegimeState = { Green: false, Yellow: false, Red: false };
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
  ema10:  { period: 10,  color: '#f59e0b', label: '10 EMA' },
  ema20:  { period: 20,  color: '#3b82f6', label: '20 EMA' },
  ema25:  { period: 25,  color: '#8b5cf6', label: '25 EMA' },
  ema50:  { period: 50,  color: '#ec4899', label: '50 EMA' },
  ema200: { period: 200, color: '#ef4444', label: '200 EMA' },
};

const OVERLAY_CONFIG = {
  spx:  { color: '#3b82f6', lineWidth: 1.5, priceScaleId: 'spx',  label: 'SPX'  },
  vix:  { color: '#f97316', lineWidth: 1.5, priceScaleId: 'vix',  label: 'VIX'  },
  mmth: { color: '#a855f7', lineWidth: 1.5, priceScaleId: 'mmth', label: 'MMTH' },
};

const CHART_OPTS = {
  layout: { background: { color: '#13161f' }, textColor: '#6b7189' },
  grid: { vertLines: { color: '#1a1e2a' }, horzLines: { color: '#1a1e2a' } },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#1e2231' },
  timeScale: { borderColor: '#1e2231', timeVisible: false },
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

// --- Regime Descriptions ---
const REGIME_DESCRIPTIONS = {
  1: 'SPY 10/20 EMA crossover signals',
  2: 'Market breadth — % stocks above moving avg',
  3: 'Cumulative net new highs vs new lows',
  4: 'SPY price vs 20/50 EMA structure',
};

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
      stratMap[t.primaryStrategy].push(t.pnl);
  });
  const results = STRATEGY_VALUES.map(s => {
    const pnls = stratMap[s];
    const n = pnls.length;
    const totalPnL = pnls.reduce((a, b) => a + b, 0);
    return { strategy: s, count: n, expectancy: n > 0 ? totalPnL / n : 0, totalPnL, lowSample: n > 0 && n < 30 };
  });
  const valFn = pnlDisplayMode === 'total' ? d => d.totalPnL : d => d.expectancy;
  results.sort((a, b) => {
    if (a.count === 0 && b.count !== 0) return -1;
    if (a.count !== 0 && b.count === 0) return 1;
    if (a.count === 0 && b.count === 0) return a.strategy.localeCompare(b.strategy);
    return valFn(b) - valFn(a);
  });
  return results;
}

// --- Heatmap Computation ---
let heatmapSortCol = 'Total';
let heatmapSortDir = -1;

function computeHeatmapData(trades) {
  const colors = ['Green', 'Yellow', 'Red'];
  const matrix = {};
  STRATEGY_VALUES.forEach(s => {
    matrix[s] = {};
    colors.forEach(c => {
      const subset = trades.filter(t => t.primaryStrategy === s && t.regimeColor === c);
      const n = subset.length;
      if (n === 0) { matrix[s][c] = { count: 0, totalPnL: 0, avgPnL: 0, winRate: 0, edgeRatio: 0 }; return; }
      const totalPnL = subset.reduce((sum, t) => sum + t.pnl, 0);
      const wins = subset.filter(t => t.pnl > 0);
      const losses = subset.filter(t => t.pnl <= 0);
      const avgWin = wins.length ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
      const avgLoss = losses.length ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
      matrix[s][c] = {
        count: n, totalPnL, avgPnL: totalPnL / n,
        winRate: wins.length / n, edgeRatio: avgLoss > 0 ? avgWin / avgLoss : 0
      };
    });
    const all = trades.filter(t => t.primaryStrategy === s);
    const n = all.length;
    const totalPnL = all.reduce((sum, t) => sum + t.pnl, 0);
    const wins = all.filter(t => t.pnl > 0);
    const losses = all.filter(t => t.pnl <= 0);
    const avgWin = wins.length ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
    matrix[s].Total = {
      count: n, totalPnL, avgPnL: n > 0 ? totalPnL / n : 0,
      winRate: n > 0 ? wins.length / n : 0, edgeRatio: avgLoss > 0 ? avgWin / avgLoss : 0
    };
  });
  return matrix;
}

function heatmapCellColor(val, count, mode) {
  if (count === 0) return 'transparent';
  const hi = mode === 'total' ? 10000 : 500;
  const lo = mode === 'total' ? 2000 : 100;
  if (val > hi) return 'rgba(16,185,129,0.35)';
  if (val > lo) return 'rgba(16,185,129,0.18)';
  if (val > 0) return 'rgba(16,185,129,0.08)';
  if (val > -lo) return 'rgba(239,68,68,0.08)';
  if (val > -hi) return 'rgba(239,68,68,0.18)';
  return 'rgba(239,68,68,0.35)';
}

function renderStrategyRegimeHeatmap() {
  const trades = getFilteredTrades();
  const matrix = computeHeatmapData(trades);
  const colors = ['Green', 'Yellow', 'Red'];
  const colorDots = { Green: 'var(--green)', Yellow: 'var(--yellow)', Red: 'var(--red)' };

  const isTotal = pnlDisplayMode === 'total';
  const valKey = isTotal ? 'totalPnL' : 'avgPnL';

  const sorted = [...STRATEGY_VALUES].sort((a, b) => {
    const aVal = matrix[a][heatmapSortCol][valKey];
    const bVal = matrix[b][heatmapSortCol][valKey];
    return (bVal - aVal) * heatmapSortDir;
  });

  const sortArrow = col => heatmapSortCol === col ? (heatmapSortDir === -1 ? ' \u25BC' : ' \u25B2') : '';
  const headerCells = colors.map(c =>
    `<th class="heatmap-sort-header" data-sort-col="${c}" style="cursor:pointer;user-select:none;"><span class="color-dot" style="background:${colorDots[c]};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle;"></span>${c}${sortArrow(c)}</th>`
  ).join('') + `<th class="heatmap-sort-header" data-sort-col="Total" style="cursor:pointer;user-select:none;">Total${sortArrow('Total')}</th>`;

  const rows = sorted.map(s => {
    const cells = colors.map(c => {
      const d = matrix[s][c];
      if (d.count === 0) {
        return `<td class="heatmap-cell no-data"><div class="heatmap-avg">\u2014</div></td>`;
      }
      const lowSample = d.count < 5 ? ' low-sample' : '';
      const displayVal = d[valKey];
      const bg = heatmapCellColor(displayVal, d.count, pnlDisplayMode);
      const valClass = displayVal >= 0 ? 'positive' : 'negative';
      return `<td class="heatmap-cell${lowSample}" style="background:${bg}">
        <div class="heatmap-avg ${valClass}">${fmtPnL(Math.round(displayVal))}</div>
        <div class="heatmap-meta">n=${d.count} \u00B7 ${Math.round(d.winRate * 100)}% WR</div>
      </td>`;
    }).join('');

    const t = matrix[s].Total;
    const totalDisplayVal = t[valKey];
    const totalValClass = totalDisplayVal >= 0 ? 'positive' : 'negative';
    const totalBg = heatmapCellColor(totalDisplayVal, t.count, pnlDisplayMode);
    const totalMeta = isTotal ? `n=${t.count} \u00B7 ${Math.round(t.winRate * 100)}% WR` : `n=${t.count} \u00B7 $${fmt(Math.abs(t.totalPnL), 0)}`;
    const totalCell = t.count === 0
      ? `<td class="heatmap-total-cell"><div class="heatmap-avg" style="color:var(--text-muted)">\u2014</div></td>`
      : `<td class="heatmap-total-cell" style="background:${totalBg}">
          <div class="heatmap-avg ${totalValClass}">${fmtPnL(Math.round(totalDisplayVal))}</div>
          <div class="heatmap-meta">${totalMeta}</div>
        </td>`;

    return `<tr><td class="heatmap-strat-label">${strategyLabel(s)}</td>${cells}${totalCell}</tr>`;
  }).join('');

  const avgActive = pnlDisplayMode === 'avg' ? ' active' : '';
  const totalActive = pnlDisplayMode === 'total' ? ' active' : '';
  const modeLabel = isTotal ? 'Total P&L' : 'Avg P&L';

  document.getElementById('heatmap-section').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:10px;">
      <div class="indicator-toggles" style="margin-bottom:0;">
        <div class="indicator-toggle pnl-mode-toggle${avgActive}" data-pnl-mode="avg" style="color:#818cf8;border-color:#818cf8;background:rgba(99,102,241,0.1);">Avg P&L</div>
        <div class="indicator-toggle pnl-mode-toggle${totalActive}" data-pnl-mode="total" style="color:#818cf8;border-color:#818cf8;background:rgba(99,102,241,0.1);">Total P&L</div>
      </div>
    </div>
    <div class="heatmap-subtitle">Showing ${modeLabel} \u00B7 Click column headers to sort \u00B7 Dimmed = &lt; 5 trades</div>
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

// --- Data Loading ---
const _cb = '?v=' + Date.now();
Promise.all([
  fetch('data.json' + _cb).then(r => { if (!r.ok) throw new Error('Failed to load data.json'); return r.json(); }),
  fetch('ohlc.json' + _cb).then(r => { if (!r.ok) throw new Error('Failed to load ohlc.json'); return r.json(); }),
]).then(([d, o]) => { DATA = d; OHLC = o; applyTagOverrides(); init(); })
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
  selectedColors = new Set(['Green', 'Yellow', 'Red', 'Unknown']);
  selectedExitColors = new Set(['Green', 'Yellow', 'Red', 'Unknown']);
  selectedTypes = new Set(['Stocks', 'Equity and Index Options']);
  selectedStrategies = new Set([...STRATEGY_VALUES, '(Untagged)']);
  selectedTradeTypes = new Set([...TRADE_TYPE_VALUES, '(Untagged)']);
  setupViewTabs();
  setupRegimeButtons();
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
}

// --- Regime Management ---
function setupRegimeButtons() {
  document.querySelectorAll('.regime-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const regime = parseInt(btn.dataset.regime);
      if (regime === currentRegime) return;

      document.querySelectorAll('.regime-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Crossfade transition
      const content = document.querySelector('.content');
      content.classList.add('transitioning');

      setTimeout(() => {
        currentRegime = regime;
        currentPage = 1;
        selectedTradeIdx = null;
        closeTradeDetail();
        updateRegimeDesc(regime);
        render();
        content.classList.remove('transitioning');
      }, 150);
    });
  });
}

function updateRegimeDesc(regime) {
  document.getElementById('regime-desc').textContent = REGIME_DESCRIPTIONS[regime] || '';
}

// --- Color Filter (Performers) ---
function setupColorFilter() {
  const container = document.getElementById('color-filter');
  const colors = ['all', 'Green', 'Yellow', 'Red', 'Unknown'];
  const labels = ['All', 'Green', 'Yellow', 'Red', 'Unknown'];
  const dotColors = { Green: '#10b981', Yellow: '#f59e0b', Red: '#ef4444', Unknown: '#6b7280' };
  colors.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'color-tab' + (c === 'all' ? ' active' : '');
    if (c !== 'all') {
      btn.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dotColors[c]};margin-right:4px;vertical-align:middle;"></span>${labels[i]}`;
    } else {
      btn.textContent = labels[i];
    }
    btn.addEventListener('click', () => {
      container.querySelectorAll('.color-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentColorFilter = c;
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
  document.querySelectorAll('.indicator-toggle[data-eq-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.eqColor;
      equityColorState[color] = !equityColorState[color];
      btn.classList.toggle('active', equityColorState[color]);
      applyEquityVisibility();
    });
  });
}

function applyEquityVisibility() {
  for (const [color, series] of Object.entries(equityBandSeries)) {
    if (series) series.applyOptions({ visible: equityColorState[color] });
  }
  for (const [color, series] of Object.entries(drawdownBandSeries)) {
    if (series) series.applyOptions({ visible: equityColorState[color] });
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
  document.querySelectorAll('.indicator-toggle[data-trade-regime]').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.tradeRegime;
      tradeRegimeState[color] = !tradeRegimeState[color];
      btn.classList.toggle('active', tradeRegimeState[color]);
      applyTradeRegimeVisibility();
    });
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

// --- Table Controls ---
function setupTableControls() {
  document.getElementById('search-input').addEventListener('input', e => {
    searchTerm = e.target.value.toLowerCase();
    currentPage = 1;
    renderTable();
  });
  setupMultiSelect('entry-color-multi', ['Green', 'Yellow', 'Red', 'Unknown'],
    v => v, selectedColors, s => { selectedColors = s; currentPage = 1; render(); },
    'All Entry Colors', 'Entry Colors'
  );
  setupMultiSelect('exit-color-multi', ['Green', 'Yellow', 'Red', 'Unknown'],
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
  });
}

// --- Trade Detail Panel ---
function setupTradeDetailPanel() {
  document.getElementById('panel-close').addEventListener('click', closeTradeDetail);
  document.getElementById('trade-detail-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeTradeDetail();
  });
}

function closeTradeDetail() {
  document.getElementById('trade-detail-overlay').classList.remove('open');
  document.body.style.overflow = '';
  selectedTradeIdx = null;
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
  return selectedColors.size === 4 &&
         selectedExitColors.size === 4 &&
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
  if (selectedColors.size < 4) parts.push(`${selectedColors.size}/4 entry colors`);
  if (selectedExitColors.size < 4) parts.push(`${selectedExitColors.size}/4 exit colors`);
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
  selectedColors = new Set(['Green', 'Yellow', 'Red', 'Unknown']);
  selectedExitColors = new Set(['Green', 'Yellow', 'Red', 'Unknown']);
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
  if (n === 0) return { '# Trades': 0, 'Total P&L': 0, 'Win Rate': 0, 'Avg P&L': 0, 'Edge Ratio': 0, 'Avg Holding Period': 0, 'Max Win': 0, 'Max Loss': 0 };
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
  return {
    '# Trades': n, 'Total P&L': totalPnL, 'Win Rate': n ? winners.length / n : 0,
    'Avg P&L': n ? totalPnL / n : 0, 'Edge Ratio': edgeRatio,
    'Avg Holding Period': Math.round(avgHold * 10) / 10,
    'Avg Win Hold': Math.round(avgWinHold * 10) / 10,
    'Avg Loss Hold': Math.round(avgLossHold * 10) / 10,
    'Max Win': Math.max(...pnls), 'Max Loss': Math.min(...pnls),
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
      <div class="stat-bar-label">Avg P&L</div>
      <div class="stat-bar-value ${avgPnL >= 0 ? 'positive' : 'negative'}">${fmtPnL(avgPnL)}</div>
      <div class="stat-bar-sub">Median: ${fmtPnL(medianPnL)}</div>
    </div>
  `;
}

// --- Regime Color Cards ---
function renderRegimeColorCards() {
  const trades = getFilteredTrades();
  const colors = [
    { key: 'Green', cls: 'green-card', dotColor: 'var(--green)' },
    { key: 'Yellow', cls: 'yellow-card', dotColor: 'var(--yellow)' },
    { key: 'Red', cls: 'red-card', dotColor: 'var(--red)' },
    { key: 'Unknown', cls: 'unknown-card', dotColor: 'var(--unknown)' },
  ];
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
  const regimes = [
    { color: 'Green', cls: 'panel-green', dotColor: 'var(--green)' },
    { color: 'Yellow', cls: 'panel-yellow', dotColor: 'var(--yellow)' },
    { color: 'Red', cls: 'panel-red', dotColor: 'var(--red)' },
  ];
  const panels = regimes.map(r => {
    const data = computeStrategyExpectancy(trades, r.color);
    const withData = data.filter(d => d.count > 0);
    const useTotal = pnlDisplayMode === 'total';
    const getVal = d => useTotal ? d.totalPnL : d.expectancy;
    const maxAbs = withData.length > 0 ? Math.max(...withData.map(d => Math.abs(getVal(d)))) : 1;
    const rows = data.map(d => {
      if (d.count === 0) {
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
      const dagger = d.lowSample ? '\u2020' : '';
      const rowCls = d.lowSample ? ' low-sample' : '';
      return `<div class="strategy-bar-row${rowCls}">
        <div class="strategy-bar-label">${strategyLabel(d.strategy)}${dagger}</div>
        <div class="strategy-bar-container">
          <div class="strategy-bar ${barCls}" style="width:${pct}%"></div>
        </div>
        <div class="strategy-bar-value ${valCls}">${fmtPnL(Math.round(val))}</div>
        <div class="strategy-bar-n">n=${d.count}${d.lowSample ? '*' : ''}</div>
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
  const spModeLabel = pnlDisplayMode === 'total' ? 'Total P&L' : 'Avg P&L';
  document.getElementById('strategy-perf-section').innerHTML = `
    <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:10px;">
      <div class="indicator-toggles" style="margin-bottom:0;">
        <div class="indicator-toggle sp-pnl-toggle${spAvgActive}" data-pnl-mode="avg" style="color:#818cf8;border-color:#818cf8;background:rgba(99,102,241,0.1);">Avg P&L</div>
        <div class="indicator-toggle sp-pnl-toggle${spTotalActive}" data-pnl-mode="total" style="color:#818cf8;border-color:#818cf8;background:rgba(99,102,241,0.1);">Total P&L</div>
      </div>
    </div>
    <div class="strategy-perf-subtitle">Showing ${spModeLabel} \u00B7 \u2020 = thin cell (n &lt; 30), descriptive only &nbsp;&nbsp; * = small sample</div>
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
  switch(color) {
    case 'Green': return '#22c55e';
    case 'Yellow': return '#eab308';
    case 'Red': return '#ef4444';
    default: return '#6b7280';
  }
}

function createEquityChart() {
  const container = document.getElementById('equity-chart');
  equityChart = LightweightCharts.createChart(container, CHART_OPTS);
  const bandColors = {
    Green:  { top: 'rgba(34,197,94,0.18)',  bottom: 'rgba(34,197,94,0.18)' },
    Yellow: { top: 'rgba(234,179,8,0.18)',   bottom: 'rgba(234,179,8,0.18)' },
    Red:    { top: 'rgba(239,68,68,0.18)',   bottom: 'rgba(239,68,68,0.18)' },
  };
  for (const [color, fill] of Object.entries(bandColors)) {
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
    color: '#e1e4eb', lineWidth: 2,
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
  const bands = { Green: [], Yellow: [], Red: [] };
  for (let i = 0; i < dates.length; i++) {
    const color = getRegimeColorForDate(dates[i], regimeKey);
    for (const c of ['Green', 'Yellow', 'Red']) {
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
  for (const color of ['Green', 'Yellow', 'Red']) {
    equityBandSeries[color].setData(bands[color]);
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
  const bandColors = {
    Green:  { top: 'rgba(34,197,94,0.18)',  bottom: 'rgba(34,197,94,0.18)' },
    Yellow: { top: 'rgba(234,179,8,0.18)',   bottom: 'rgba(234,179,8,0.18)' },
    Red:    { top: 'rgba(239,68,68,0.18)',   bottom: 'rgba(239,68,68,0.18)' },
  };
  for (const [color, fill] of Object.entries(bandColors)) {
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
    lineColor: '#ef4444', topColor: 'rgba(239,68,68,0.05)',
    bottomColor: 'rgba(239,68,68,0.25)', lineWidth: 2, invertFilledArea: true,
  });
}

function renderDrawdownChart() {
  const ec = getEquityCurveData();
  const regimeKey = 'regime' + currentRegime;
  drawdownSeries.setData(ec.map(e => ({ time: e.date, value: e.drawdown })));
  const bands = buildRegimeBandData(ec.map(e => e.date), regimeKey);
  for (const color of ['Green', 'Yellow', 'Red']) {
    drawdownBandSeries[color].setData(bands[color]);
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
  renderPerformerList('top-performers', sorted.slice(0, 5), 'top');
  renderPerformerList('bottom-performers', sorted.slice(-5).reverse(), 'bottom');
}

function renderPerformerList(containerId, items, type) {
  const container = document.getElementById(containerId);
  container.innerHTML = items.map((t, i) => {
    const isOpt = t.type === 'Equity and Index Options';
    const pctChange = (!isOpt && t.entry > 0) ? ((t.exit - t.entry) / t.entry * 100) : null;
    const isTop = type === 'top';
    const strategyTag = t.strategy ? `<span style="color:var(--text-dim);font-size:11px;"> (${t.strategy})</span>` : '';
    return `
      <div class="performer-item" onclick="showTradeDetail(${t.tradeId})">
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

function showTradeDetail(tradeId) {
  const overlay = document.getElementById('trade-detail-overlay');
  const isAlreadyOpen = overlay.classList.contains('open');

  if (!isAlreadyOpen) {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  const trades = getTrades();
  const trade = trades.find(t => t.tradeId === tradeId);
  if (!trade) return;

  selectedTradeIdx = tradeId;

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
  const tradeBandColors = {
    Green:  { top: 'rgba(34,197,94,0.18)',  bottom: 'rgba(34,197,94,0.18)' },
    Yellow: { top: 'rgba(234,179,8,0.18)',   bottom: 'rgba(234,179,8,0.18)' },
    Red:    { top: 'rgba(239,68,68,0.18)',   bottom: 'rgba(239,68,68,0.18)' },
  };
  const regimeKey = 'regime' + currentRegime;
  for (const [color, fill] of Object.entries(tradeBandColors)) {
    tradeRegimeBandSeries[color] = tradeChart.addAreaSeries({
      lineWidth: 0, lineColor: 'transparent',
      topColor: fill.top, bottomColor: fill.bottom,
      lineType: 1, priceScaleId: 'tradeRegime',
      lastValueVisible: false, priceLineVisible: false,
      crosshairMarkerVisible: false,
      visible: tradeRegimeState[color],
    });
  }
  tradeChart.priceScale('tradeRegime').applyOptions({
    visible: false, scaleMargins: { top: 0, bottom: 0 },
  });
  const tradeDates = candleData.map(d => d.time);
  const tradeRegimeBands = buildRegimeBandData(tradeDates, regimeKey);
  for (const color of ['Green', 'Yellow', 'Red']) {
    tradeRegimeBandSeries[color].setData(tradeRegimeBands[color]);
  }

  tradeSeries = tradeChart.addCandlestickSeries({
    upColor: '#22c55e', downColor: '#ef4444',
    borderUpColor: '#22c55e', borderDownColor: '#ef4444',
    wickUpColor: '#22c55e', wickDownColor: '#ef4444',
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

  // Entry/exit markers
  const isOptions = trade.type === 'Equity and Index Options';
  const entryMarkerDate = candleData.find(d => d.time >= trade.entryDate)?.time || candleData[0].time;
  const exitMarkerDate = candleData.find(d => d.time >= trade.exitDate)?.time || candleData[candleData.length - 1].time;

  const markers = [
    {
      time: entryMarkerDate,
      position: 'belowBar', color: '#3b82f6', shape: 'arrowUp',
      text: isOptions ? 'Entry' : `Entry $${entryPrice.toFixed(2)}`,
    },
    {
      time: exitMarkerDate,
      position: 'aboveBar', color: isWin ? '#22c55e' : '#ef4444', shape: 'arrowDown',
      text: isOptions ? `Exit ${fmtPnL(trade.pnl)}` : `Exit $${exitPrice.toFixed(2)}`,
    },
  ];
  markers.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  tradeSeries.setMarkers(markers);

  if (!isOptions) {
    tradeSeries.createPriceLine({
      price: entryPrice, color: '#3b82f6', lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'Entry',
    });
    tradeSeries.createPriceLine({
      price: exitPrice, color: isWin ? '#22c55e' : '#ef4444', lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'Exit',
    });
  }

  tradeChart.timeScale().fitContent();

  // MACD chart
  macdContainer.style.display = 'block';
  macdChart = LightweightCharts.createChart(macdContainer, {
    ...CHART_OPTS,
    rightPriceScale: { borderColor: '#2a2e3d', scaleMargins: { top: 0.1, bottom: 0.1 } },
  });

  const macdResult = calcMACD(allCloses, 12, 26, 9);

  const histData = [];
  for (let i = visibleOffset; i < calcSlice.length; i++) {
    if (macdResult.histogram[i] !== null) {
      histData.push({
        time: calcSlice[i].t,
        value: Math.round(macdResult.histogram[i] * 10000) / 10000,
        color: macdResult.histogram[i] >= 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)',
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
    color: '#06b6d4', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: 'MACD',
  });
  macdLineSeries.setData(macdLineData);

  const signalData = [];
  for (let i = visibleOffset; i < calcSlice.length; i++) {
    if (macdResult.signal[i] !== null) {
      signalData.push({ time: calcSlice[i].t, value: Math.round(macdResult.signal[i] * 10000) / 10000 });
    }
  }
  macdSignalSeries = macdChart.addLineSeries({
    color: '#f97316', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: 'Signal',
    lineStyle: LightweightCharts.LineStyle.Dashed,
  });
  macdSignalSeries.setData(signalData);

  macdHistSeries.createPriceLine({
    price: 0, color: '#4b5563', lineWidth: 1,
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
function renderTable() {
  const trades = getTrades();
  let filtered = [...trades];
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

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(start, start + PAGE_SIZE);

  if (filtered.length === 0) {
    document.getElementById('trades-tbody').innerHTML = `<tr><td colspan="14" style="padding:32px;text-align:center;color:var(--text-dim);font-size:13px;">No trades match your filters</td></tr>`;
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
    if (selectedColors.size < 4) count++;
    if (selectedExitColors.size < 4) count++;
    if (selectedTypes.size < 2) count++;
    if (selectedStrategies.size < STRATEGY_VALUES.length + 1) count++;
    if (selectedTradeTypes.size < TRADE_TYPE_VALUES.length + 1) count++;
    if (dateFrom || dateTo) count++;
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  }
}

// --- Resize Handling ---
window.addEventListener('resize', () => {
  if (equityChart) equityChart.applyOptions({ width: document.getElementById('equity-chart').clientWidth });
  if (drawdownChart) drawdownChart.applyOptions({ width: document.getElementById('drawdown-chart').clientWidth });
  if (tradeChart) tradeChart.applyOptions({ width: document.getElementById('trade-chart').clientWidth });
  if (macdChart) macdChart.applyOptions({ width: document.getElementById('macd-chart').clientWidth });
});

new ResizeObserver(() => {
  if (equityChart) equityChart.applyOptions({ width: document.getElementById('equity-chart').clientWidth });
}).observe(document.getElementById('equity-chart'));

new ResizeObserver(() => {
  if (drawdownChart) drawdownChart.applyOptions({ width: document.getElementById('drawdown-chart').clientWidth });
}).observe(document.getElementById('drawdown-chart'));

/**
 * app.js — Device 153 Energy Monitoring Dashboard
 *
 * Fetches three public GitHub raw files, parses them in the browser,
 * and renders KPI cards, an anomaly score strip, a Chart.js hourly chart,
 * and a detailed hourly breakdown table.
 *
 * Auto-refreshes every 5 minutes. No backend, no credentials.
 * All times displayed in Asia/Kolkata (IST, UTC+5:30).
 */

'use strict';

/* ══════════════════════════════════════════════════════════════════
   CONFIG
══════════════════════════════════════════════════════════════════ */
const CONFIG = {
  urls: {
    aiResults:         'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/main/results/ai_results.csv',
    hourlyPredictions: 'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/main/results/hourly_predictions.csv',
    state:             'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/main/data/state.json',
  },
  refreshInterval: 5 * 60 * 1000,   // 5 minutes
  timezone:        'Asia/Kolkata',
};

/* ══════════════════════════════════════════════════════════════════
   DOM REFERENCES
══════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const UI = {
  loadingOverlay:   $('loading-overlay'),
  errorOverlay:     $('error-overlay'),
  errorMessage:     $('error-message'),
  mainContent:      $('main-content'),
  lastUpdated:      $('last-updated'),
  updateDot:        $('update-dot'),
  btnRefresh:       $('btn-refresh'),
  btnRetry:         $('btn-retry'),
  refreshIcon:      $('refresh-icon'),

  // KPI values
  kpiPredicted:     $('kpi-predicted'),
  kpiActual:        $('kpi-actual'),
  kpiActualUnit:    $('kpi-actual-unit'),
  kpiError:         $('kpi-error'),
  kpiErrorUnit:     $('kpi-error-unit'),
  kpiAnomalyStatus: $('kpi-anomaly-status'),

  // Anomaly strip
  anomalyScore:     $('anomaly-score'),
  anomalyThreshold: $('anomaly-threshold'),
  anomalyMAE:       $('anomaly-mae'),
  anomalyCluster:   $('anomaly-cluster'),
  dataDate:         $('data-date'),
  anomalyBarFill:   $('anomaly-bar-fill'),
  anomalyBarThresh: $('anomaly-bar-threshold'),
  anomalyBarTrack:  $('anomaly-bar-track'),
  barThreshLabel:   $('bar-threshold-label'),
  barMaxLabel:      $('bar-max-label'),

  // Chart & table
  hourlyTableBody:  $('hourly-table-body'),
  noActualNote:     $('no-actual-note'),
};

/* ══════════════════════════════════════════════════════════════════
   CHART INSTANCE
══════════════════════════════════════════════════════════════════ */
let hourlyChart = null;

/* ══════════════════════════════════════════════════════════════════
   UTILITY — SAFE TEXT
══════════════════════════════════════════════════════════════════ */
/**
 * Safely escapes a string for insertion into DOM text content.
 * Using textContent (not innerHTML) is the primary defence;
 * this helper is used for any value placed into attributes.
 */
function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ══════════════════════════════════════════════════════════════════
   UTILITY — TIME
══════════════════════════════════════════════════════════════════ */
function nowIST() {
  return new Date().toLocaleString('en-IN', {
    timeZone:     CONFIG.timezone,
    day:          '2-digit',
    month:        'short',
    year:         'numeric',
    hour:         '2-digit',
    minute:       '2-digit',
    second:       '2-digit',
    hour12:       true,
  });
}

function formatISOtoIST(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return escapeAttr(isoString);
    return d.toLocaleString('en-IN', {
      timeZone: CONFIG.timezone,
      day:      '2-digit',
      month:    'short',
      year:     'numeric',
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   true,
    });
  } catch {
    return escapeAttr(isoString);
  }
}

function hourLabel(h) {
  const n = parseInt(h, 10);
  if (isNaN(n)) return String(h);
  const suffix = n >= 12 ? 'PM' : 'AM';
  const h12    = n % 12 === 0 ? 12 : n % 12;
  return `${String(h12).padStart(2, '0')}:00 ${suffix}`;
}

/* ══════════════════════════════════════════════════════════════════
   UTILITY — CSV PARSER
══════════════════════════════════════════════════════════════════ */
/**
 * Minimal RFC-4180-aware CSV parser.
 * Returns an array of objects keyed by the header row.
 * Handles quoted fields, embedded commas, and CRLF line endings.
 */
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]);
  const rows    = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCSVLine(line);
    const row    = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx] !== undefined ? values[idx].trim() : '';
    });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const result  = [];
  let current   = '';
  let inQuotes  = false;

  for (let i = 0; i < line.length; i++) {
    const ch   = line[i];
    const next = line[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') { current += '"'; i++; }
      else if (ch === '"')           { inQuotes = false; }
      else                           { current += ch; }
    } else {
      if (ch === '"')  { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else             { current += ch; }
    }
  }
  result.push(current);
  return result;
}

/* ══════════════════════════════════════════════════════════════════
   UTILITY — NUMBER HELPERS
══════════════════════════════════════════════════════════════════ */
function toFloat(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function fmt(v, decimals = 2) {
  if (v === null || v === undefined || v === '') return null;
  const n = toFloat(v);
  if (n === null) return null;
  return n.toFixed(decimals);
}

/* ══════════════════════════════════════════════════════════════════
   FETCH DATA
══════════════════════════════════════════════════════════════════ */
async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function loadAllData() {
  const [aiText, hourlyText, stateData] = await Promise.all([
    fetchText(CONFIG.urls.aiResults),
    fetchText(CONFIG.urls.hourlyPredictions),
    fetchJSON(CONFIG.urls.state),
  ]);

  const aiRows     = parseCSV(aiText);
  const hourlyRows = parseCSV(hourlyText);

  return { aiRows, hourlyRows, stateData };
}

/* ══════════════════════════════════════════════════════════════════
   PROCESS DATA
══════════════════════════════════════════════════════════════════ */
/**
 * Returns the latest row from ai_results.csv.
 * "Latest" = largest processed_at timestamp.
 */
function getLatestAiRow(rows) {
  if (!rows || rows.length === 0) return null;
  return rows.reduce((best, row) => {
    if (!best) return row;
    return row.processed_at > best.processed_at ? row : best;
  }, null);
}

/**
 * Returns hourly rows for the same date as the latest ai_results row.
 * Falls back to the most recent date found in hourly_predictions.csv.
 */
function getHourlyForDate(hourlyRows, targetDate) {
  if (!hourlyRows || hourlyRows.length === 0) return [];
  const filtered = targetDate
    ? hourlyRows.filter(r => r.date === targetDate)
    : [];
  if (filtered.length > 0) return filtered;

  // Fallback: use latest date in the file
  const dates = [...new Set(hourlyRows.map(r => r.date))].sort();
  const latest = dates[dates.length - 1];
  return hourlyRows.filter(r => r.date === latest);
}

function currentISTParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const value = name => parts.find(p => p.type === name)?.value;
  return { date: `${value('year')}-${value('month')}-${value('day')}`, hour: Number(value('hour')) };
}

function mergeLiveActuals(hourlyRows, stateData) {
  const rows = hourlyRows.map(row => ({ ...row }));
  const current = currentISTParts();
  const profile = stateData?.profiles?.[current.date];
  if (!profile) return rows;

  const rowsByHour = new Map(rows.map(row => [Number(row.hour), row]));
  for (let h = 0; h < current.hour; h++) {
    const actual = toFloat(profile[String(h)]);
    const row = rowsByHour.get(h);
    if (!row || actual === null) continue;
    // Only completed hours are safe to expose; ignore current/future placeholders.
    row.actual_kwh = String(actual);
    const predicted = toFloat(row.predicted_kwh);
    if (predicted !== null) row.error_kwh = String(actual - predicted);
  }
  return rows;
}

/* ══════════════════════════════════════════════════════════════════
   RENDER — KPI CARDS
══════════════════════════════════════════════════════════════════ */
function renderKPI(ai) {
  if (!ai) return;

  // Predicted kWh (today's forward prediction)
  const predicted = fmt(ai.prediction_kwh);
  UI.kpiPredicted.textContent = predicted !== null ? predicted : '—';

  // Actual kWh
  const actual = fmt(ai.actual_kwh);
  if (actual !== null) {
    UI.kpiActual.textContent = actual;
  } else {
    UI.kpiActual.textContent = 'Pending';
    UI.kpiActualUnit.textContent = '';
  }

  // Prediction error
  const err = fmt(ai.prediction_error_kwh);
  if (err !== null) {
    UI.kpiError.textContent = err;
  } else {
    UI.kpiError.textContent = 'N/A';
    UI.kpiErrorUnit.textContent = '';
  }

  // Anomaly status
  const status = (ai.status || '').toLowerCase().trim();
  UI.kpiAnomalyStatus.textContent = '';
  UI.kpiAnomalyStatus.className   = 'kpi-card__value kpi-card__value--status';

  if (status === 'anomaly') {
    UI.kpiAnomalyStatus.textContent = '⚠ Anomaly';
    UI.kpiAnomalyStatus.classList.add('status--anomaly');
  } else if (status === 'normal') {
    UI.kpiAnomalyStatus.textContent = '✓ Normal';
    UI.kpiAnomalyStatus.classList.add('status--normal');
  } else if (status.includes('wait') || status.includes('complete') || status === '') {
    UI.kpiAnomalyStatus.textContent = '⏳ Waiting for complete day';
    UI.kpiAnomalyStatus.classList.add('status--waiting');
  } else {
    UI.kpiAnomalyStatus.textContent = escapeAttr(ai.status) || '—';
  }
}

/* ══════════════════════════════════════════════════════════════════
   RENDER — ANOMALY STRIP
══════════════════════════════════════════════════════════════════ */
function renderAnomalyStrip(ai) {
  if (!ai) return;

  const score     = toFloat(ai.anomaly_score);
  const threshold = toFloat(ai.anomaly_threshold);

  UI.anomalyScore.textContent     = score     !== null ? score.toFixed(4)     : '—';
  UI.anomalyThreshold.textContent = threshold !== null ? threshold.toFixed(4) : '—';
  UI.anomalyMAE.textContent       = toFloat(ai.hourly_error_mae) !== null
    ? toFloat(ai.hourly_error_mae).toFixed(3) : '—';
  UI.anomalyCluster.textContent   = ai.cluster !== '' ? escapeAttr(ai.cluster) : '—';
  UI.dataDate.textContent         = ai.date    !== '' ? escapeAttr(ai.date)    : '—';

  // Progress bar
  if (score !== null && threshold !== null) {
    const maxVal  = Math.max(score, threshold) * 1.4;
    const fillPct = Math.min((score / maxVal) * 100, 100);
    const threshPct = Math.min((threshold / maxVal) * 100, 100);

    UI.anomalyBarFill.style.width  = `${fillPct.toFixed(1)}%`;
    UI.anomalyBarThresh.style.left = `${threshPct.toFixed(1)}%`;
    UI.anomalyBarTrack.setAttribute('aria-valuenow', fillPct.toFixed(0));

    UI.barThreshLabel.textContent = `Threshold ${threshold.toFixed(2)}`;
    UI.barMaxLabel.textContent    = `Max ~${maxVal.toFixed(2)}`;

    if (score > threshold) {
      UI.anomalyBarFill.classList.add('anomaly-bar-fill--danger');
    } else {
      UI.anomalyBarFill.classList.remove('anomaly-bar-fill--danger');
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   RENDER — CHART
══════════════════════════════════════════════════════════════════ */
function renderChart(hourlyRows) {
  const canvas  = document.getElementById('hourly-chart');
  const ctx     = canvas.getContext('2d');

  // Build 0-23 hour skeleton
  const hourMap = {};
  for (let h = 0; h < 24; h++) hourMap[h] = { predicted: null, actual: null, error: null };

  hourlyRows.forEach(r => {
    const h = parseInt(r.hour, 10);
    if (isNaN(h) || h < 0 || h > 23) return;
    hourMap[h] = {
      predicted: toFloat(r.predicted_kwh),
      actual:    toFloat(r.actual_kwh),
      error:     toFloat(r.error_kwh),
    };
  });

  const labels    = Array.from({ length: 24 }, (_, h) => hourLabel(h));
  const predicted = Array.from({ length: 24 }, (_, h) => hourMap[h].predicted);
  const actual    = Array.from({ length: 24 }, (_, h) => hourMap[h].actual);
  const error     = Array.from({ length: 24 }, (_, h) => hourMap[h].error);

  const hasActual = actual.some(v => v !== null);
  const hasError  = error.some(v => v !== null);

  const datasets = [
    {
      label:           'Predicted kWh',
      data:            predicted,
      borderColor:     'rgba(59,130,246,1)',
      backgroundColor: 'rgba(59,130,246,0.12)',
      borderWidth:     2.5,
      pointRadius:     3,
      pointHoverRadius: 6,
      tension:         0.4,
      fill:            true,
      spanGaps:        true,
    },
  ];

  if (hasActual) {
    datasets.push({
      label:           'Actual kWh',
      data:            actual,
      borderColor:     'rgba(34,197,94,1)',
      backgroundColor: 'rgba(34,197,94,0.08)',
      borderWidth:     2.5,
      pointRadius:     3,
      pointHoverRadius: 6,
      tension:         0.4,
      fill:            false,
      spanGaps:        true,
    });
  }

  if (hasError) {
    datasets.push({
      label:           'Error kWh',
      data:            error,
      borderColor:     'rgba(245,158,11,1)',
      backgroundColor: 'transparent',
      borderWidth:     1.5,
      borderDash:      [5, 4],
      pointRadius:     2,
      pointHoverRadius: 5,
      tension:         0.3,
      fill:            false,
      spanGaps:        true,
    });
  }

  const chartData = { labels, datasets };

  const commonScaleOptions = {
    grid:   { color: 'rgba(255,255,255,0.05)', drawBorder: false },
    ticks:  { color: '#64748b', font: { family: "'Inter', sans-serif", size: 11 } },
  };

  const options = {
    responsive:          true,
    maintainAspectRatio: false,
    interaction:         { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(14,22,35,0.95)',
        borderColor:     'rgba(255,255,255,0.1)',
        borderWidth:     1,
        titleColor:      '#e2e8f0',
        bodyColor:       '#94a3b8',
        padding:         12,
        titleFont:       { family: "'Inter', sans-serif", size: 12, weight: '600' },
        bodyFont:        { family: "'Inter', sans-serif", size: 11 },
        callbacks: {
          label(ctx) {
            const v = ctx.parsed.y;
            if (v === null || v === undefined) return `${ctx.dataset.label}: N/A`;
            return `${ctx.dataset.label}: ${v.toFixed(2)} kWh`;
          },
        },
      },
    },
    scales: {
      x: {
        ...commonScaleOptions,
        ticks: {
          ...commonScaleOptions.ticks,
          maxRotation: 45,
          autoSkip:    true,
          maxTicksLimit: 12,
        },
      },
      y: {
        ...commonScaleOptions,
        title: {
          display: true,
          text:    'Energy (kWh)',
          color:   '#64748b',
          font:    { family: "'Inter', sans-serif", size: 11 },
        },
      },
    },
  };

  if (hourlyChart) {
    hourlyChart.data    = chartData;
    hourlyChart.options = options;
    hourlyChart.update('active');
  } else {
    hourlyChart = new Chart(ctx, { type: 'line', data: chartData, options });
  }
}

/* ══════════════════════════════════════════════════════════════════
   RENDER — HOURLY TABLE
══════════════════════════════════════════════════════════════════ */
function renderTable(hourlyRows) {
  // Build hour map 0-23
  const hourMap = {};
  for (let h = 0; h < 24; h++) {
    hourMap[h] = { predicted: null, actual: null, error: null };
  }

  hourlyRows.forEach(r => {
    const h = parseInt(r.hour, 10);
    if (isNaN(h) || h < 0 || h > 23) return;
    hourMap[h] = {
      predicted: toFloat(r.predicted_kwh),
      actual:    toFloat(r.actual_kwh),
      error:     toFloat(r.error_kwh),
    };
  });

  const hasAny = Object.values(hourMap).some(v => v.actual !== null);
  UI.noActualNote.classList.remove('hidden');
  UI.noActualNote.lastChild.textContent = hasAny
    ? 'Actual values are shown for completed hours; final daily results are confirmed after the 24-hour cycle.'
    : 'Actual values are not yet available for this period';

  const tbody = UI.hourlyTableBody;
  tbody.textContent = ''; // safe clear

  for (let h = 0; h < 24; h++) {
    const row  = hourMap[h];
    const tr   = document.createElement('tr');

    const tdHour = document.createElement('td');
    tdHour.textContent = hourLabel(h);
    tr.appendChild(tdHour);

    const tdPred = document.createElement('td');
    tdPred.classList.add(row.predicted !== null ? 'td-predicted' : 'td-na');
    tdPred.textContent = row.predicted !== null ? row.predicted.toFixed(2) : 'N/A';
    tr.appendChild(tdPred);

    const tdActual = document.createElement('td');
    tdActual.classList.add(row.actual !== null ? 'td-actual' : 'td-na');
    tdActual.textContent = row.actual !== null ? row.actual.toFixed(2) : '—';
    tr.appendChild(tdActual);

    const tdError = document.createElement('td');
    tdError.classList.add(row.error !== null ? 'td-error' : 'td-na');
    tdError.textContent = row.error !== null ? row.error.toFixed(2) : '—';
    tr.appendChild(tdError);

    tbody.appendChild(tr);
  }
}

/* ══════════════════════════════════════════════════════════════════
   UI STATE HELPERS
══════════════════════════════════════════════════════════════════ */
function showLoading() {
  UI.loadingOverlay.classList.remove('hidden');
  UI.errorOverlay.classList.add('hidden');
  UI.mainContent.classList.add('hidden');
  UI.updateDot.className = 'update-dot update-dot--loading';
  UI.refreshIcon.classList.add('btn-refresh__icon--spinning');
  UI.lastUpdated.textContent = 'Loading…';
}

function showError(msg) {
  UI.loadingOverlay.classList.add('hidden');
  UI.errorOverlay.classList.remove('hidden');
  UI.mainContent.classList.add('hidden');
  UI.updateDot.className = 'update-dot update-dot--error';
  UI.refreshIcon.classList.remove('btn-refresh__icon--spinning');
  // Use textContent to prevent XSS
  UI.errorMessage.textContent = `Failed to load data: ${msg}. Check your internet connection and try again.`;
  UI.lastUpdated.textContent = 'Error';
}

function showContent() {
  UI.loadingOverlay.classList.add('hidden');
  UI.errorOverlay.classList.add('hidden');
  UI.mainContent.classList.remove('hidden');
  UI.updateDot.className = 'update-dot';
  UI.refreshIcon.classList.remove('btn-refresh__icon--spinning');
  UI.lastUpdated.textContent = `Updated ${nowIST()} IST`;
}

/* ══════════════════════════════════════════════════════════════════
   MAIN REFRESH CYCLE
══════════════════════════════════════════════════════════════════ */
async function refresh() {
  showLoading();
  try {
    const { aiRows, hourlyRows, stateData } = await loadAllData();

    const latestAI    = getLatestAiRow(aiRows);
    const targetDate  = latestAI ? latestAI.date : null;
    const hourlyToday = mergeLiveActuals(getHourlyForDate(hourlyRows, targetDate), stateData);

    renderKPI(latestAI);
    renderAnomalyStrip(latestAI);
    renderChart(hourlyToday);
    renderTable(hourlyToday);

    showContent();
  } catch (err) {
    console.error('[EnergyDash] Fetch error:', err);
    showError(err.message || 'Unknown error');
  }
}

/* ══════════════════════════════════════════════════════════════════
   AUTO-REFRESH & EVENT LISTENERS
══════════════════════════════════════════════════════════════════ */
let refreshTimer = null;

function scheduleAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refresh, CONFIG.refreshInterval);
}

function handleRefreshClick() {
  clearInterval(refreshTimer);
  refresh().then(scheduleAutoRefresh);
}

UI.btnRefresh.addEventListener('click', handleRefreshClick);
UI.btnRetry.addEventListener('click', handleRefreshClick);

/* ══════════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════════ */
(function init() {
  refresh().then(scheduleAutoRefresh);
})();

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
    dashboardData:     'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/live-data/results/dashboard_data.json',
    aiResults:         'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/live-data/results/ai_results.csv',
    dailyTotals:       'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/live-data/results/daily_totals.csv',
    hourlyPredictions: 'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/live-data/results/hourly_predictions.csv',
    state:             'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/main/data/state.json',
  },
  refreshInterval: 5 * 60 * 1000,   // 5 minutes
  timezone:        'Asia/Kolkata',
  maxRetries: 3,
  cacheMaxAgeMs: 30 * 60 * 1000,
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
  kpiPredictedLabel: $('kpi-predicted-label'),
  predictionRange:  $('prediction-range'),
  kpiActual:        $('kpi-actual'),
  kpiActualLabel:   $('kpi-actual-label'),
  kpiActualUnit:    $('kpi-actual-unit'),
  kpiError:         $('kpi-error'),
  kpiErrorLabel:    $('kpi-error-label'),
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
  historyTableBody: $('history-table-body'),
  historyDateSelect: $('history-date-select'),
  anomalyInvestigationList: $('anomaly-investigation-list'),
  suggestionsList:  $('suggestions-list'),
  collectorHealth:  $('collector-health'),
  collectorLastRun: $('collector-last-run'),
  recordsCount:     $('records-count'),
  dataFreshness:    $('data-freshness'),
  apiLatency:       $('api-latency'),
  currentDataStatus:$('current-data-status'),
  hourlyDataDate:   $('hourly-data-date'),
  hourlyChartSummary:$('hourly-chart-summary'),
  dailyChartSummary: $('daily-chart-summary'),
  diagnosticStatus: $('pipeline-diagnostic-status'),
  diagnosticMessage:$('pipeline-diagnostic-message'),
  historyCaption:   $('history-chart-caption'),
  dailyMAE:         $('daily-mae'),
  dailyRMSE:        $('daily-rmse'),
  hourlyMAE:        $('hourly-mae'),
  completedDays:    $('completed-days'),
  performanceNote:  $('performance-note'),
  aiLearningStatus: $('ai-learning-status'),
  aiLearningSamples: $('ai-learning-samples'),
  aiBaselineMae: $('ai-baseline-mae'),
  aiAdaptedMae: $('ai-adapted-mae'),
  aiDifferenceKwh: $('ai-difference-kwh'),
  aiImprovementPercent: $('ai-improvement-percent'),
  aiRateComparison: $('ai-rate-comparison'),
  aiImprovementMessage: $('ai-improvement-message'),
};

/* ══════════════════════════════════════════════════════════════════
   CHART INSTANCE
══════════════════════════════════════════════════════════════════ */
let hourlyChart = null;
let dailyChart = null;
let historyDays = 7;
let selectedHistoryDate = '';
let activePayload = null;

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

function rowPredictionError(row) {
  const recorded = toFloat(row?.prediction_error_kwh);
  if (recorded !== null) return recorded;
  const actual = toFloat(row?.actual_kwh);
  const predicted = toFloat(row?.prediction_kwh);
  return actual !== null && predicted !== null ? actual - predicted : null;
}

/* ══════════════════════════════════════════════════════════════════
   FETCH DATA
══════════════════════════════════════════════════════════════════ */
async function fetchWithRetry(url, asJson = false) {
  const fallback = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  const cdnUrl = fallback ? `https://cdn.jsdelivr.net/gh/${fallback[1]}/${fallback[2]}@${fallback[3]}/${fallback[4]}` : url;
  const fallbacks = [...new Set([url, cdnUrl])];
  let lastError;
  for (const candidate of fallbacks) {
    for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
      try {
        const separator = candidate.includes('?') ? '&' : '?';
        const res = await fetch(`${candidate}${separator}t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return asJson ? await res.json() : await res.text();
      } catch (err) {
        lastError = err;
        if (attempt < CONFIG.maxRetries) await new Promise(resolve => setTimeout(resolve, 400 * attempt));
      }
    }
  }
  throw new Error(`${lastError?.message || 'request failed'} (${url})`);
}

async function loadAllData() {
  try {
    const payload = await fetchWithRetry(CONFIG.urls.dashboardData, true);
    const normalized = { aiRows: payload.ai_results || [], hourlyRows: payload.hourly_predictions || [], dailyTotalRows: payload.daily_totals || [], stateData: payload.state || {}, health: { ...(payload.health || {}), source: 'live consolidated payload', generated_at: payload.generated_at } };
    saveCache(normalized);
    return normalized;
  } catch (combinedError) {
    const [aiText, hourlyText, dailyTotalsText, stateData] = await Promise.all([
      fetchWithRetry(CONFIG.urls.aiResults),
      fetchWithRetry(CONFIG.urls.hourlyPredictions),
      fetchWithRetry(CONFIG.urls.dailyTotals),
      fetchWithRetry(CONFIG.urls.state, true),
    ]);
    const normalized = { aiRows: parseCSV(aiText), hourlyRows: parseCSV(hourlyText), dailyTotalRows: parseCSV(dailyTotalsText), stateData, health: { collector_status: 'legacy payload', source: 'legacy files fallback', error: combinedError.message } };
    saveCache(normalized);
    return normalized;
  }
}

function saveCache(data) {
  try {
    localStorage.setItem('energy-dashboard-cache', JSON.stringify({ cachedAt: Date.now(), data }));
  } catch (err) {
    console.warn('[EnergyDash] Cache write skipped:', err);
  }
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
 * Returns hourly rows only for the requested date.
 * Never substitutes another date: mixing dates makes the dashboard misleading.
 */
function getHourlyForDate(hourlyRows, targetDate) {
  if (!hourlyRows || hourlyRows.length === 0 || !targetDate) return [];
  return hourlyRows.filter(r => r.date === targetDate);
}

function getHourlyDisplayContext(aiRows, hourlyRows) {
  const latestAI = getLatestAiRow(aiRows);
  const selectedAI = selectedHistoryDate ? aiRows.find(row => row.date === selectedHistoryDate) : null;
  const displayAI = selectedAI || latestAI;
  const currentDate = currentISTParts().date;
  const currentRows = getHourlyForDate(hourlyRows, currentDate);
  if (!selectedHistoryDate && currentRows.length > 0 && latestAI?.date !== currentDate) {
    return { date: currentDate, pendingDailyDate: latestAI?.date || null };
  }
  return { date: displayAI?.date || null, pendingDailyDate: null };
}

function currentISTParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CONFIG.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const value = name => parts.find(p => p.type === name)?.value;
  const rawHour = Number(value('hour'));
  return { date: `${value('year')}-${value('month')}-${value('day')}`, hour: rawHour === 24 ? 0 : rawHour };
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

  const recordDate = ai.date || 'latest completed day';
  UI.kpiPredictedLabel.textContent = `Forecast after ${recordDate}`;
  UI.kpiActualLabel.textContent = `Actual — ${recordDate}`;
  UI.kpiErrorLabel.textContent = `Prediction Error — ${recordDate}`;

  // Forward forecast associated with this completed record.
  const predicted = fmt(ai.prediction_kwh);
  UI.kpiPredicted.textContent = predicted !== null ? predicted : '—';
  const lower = fmt(ai.prediction_lower_kwh);
  const upper = fmt(ai.prediction_upper_kwh);
  UI.predictionRange.textContent = lower !== null && upper !== null ? `Expected range: ${lower}–${upper} kWh` : 'Expected range: —';

  // Actual kWh
  const actual = fmt(ai.actual_kwh);
  if (actual !== null) {
    UI.kpiActual.textContent = actual;
    UI.kpiActualUnit.textContent = 'kWh';
  } else {
    UI.kpiActual.textContent = 'Pending';
    UI.kpiActualUnit.textContent = '';
  }

  // Prediction error
  const err = fmt(rowPredictionError(ai));
  if (err !== null) {
    UI.kpiError.textContent = err;
    UI.kpiErrorUnit.textContent = 'kWh';
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
  } else if (status === 'daily_total_only') {
    UI.kpiAnomalyStatus.textContent = 'Daily total only';
    UI.kpiAnomalyStatus.classList.add('status--waiting');
  } else {
    UI.kpiAnomalyStatus.textContent = escapeAttr(ai.status) || '—';
  }
}

/* ══════════════════════════════════════════════════════════════════
   RENDER — ANOMALY STRIP
══════════════════════════════════════════════════════════════════ */
function renderAnomalyStrip(ai) {
  if (!ai) {
    UI.anomalyBarFill.style.width = '0%';
    UI.anomalyBarThresh.style.left = '0%';
    UI.barThreshLabel.textContent = 'Threshold —';
    UI.barMaxLabel.textContent = 'Max —';
    return;
  }

  const score     = toFloat(ai.anomaly_score);
  const threshold = toFloat(ai.anomaly_threshold);
  UI.anomalyBarFill.classList.remove('anomaly-bar-fill--danger');

  UI.anomalyScore.textContent     = score     !== null ? score.toFixed(4)     : '—';
  UI.anomalyThreshold.textContent = threshold !== null ? threshold.toFixed(4) : '—';
  UI.anomalyMAE.textContent       = toFloat(ai.hourly_error_mae) !== null
    ? toFloat(ai.hourly_error_mae).toFixed(3) : '—';
  UI.anomalyCluster.textContent   = ai.cluster !== '' ? escapeAttr(ai.cluster) : '—';
  UI.dataDate.textContent         = ai.date    !== '' ? escapeAttr(ai.date)    : '—';

  // Progress bar
  if (score !== null && threshold !== null) {
    const maxVal  = Math.max(Math.max(score, threshold) * 1.4, 1e-9);
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
function renderChart(hourlyRows, context = {}) {
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
  const chartDate = hourlyRows[0]?.date || 'no matching date';
  UI.hourlyDataDate.textContent = context.pendingDailyDate
    ? `Forecast date: ${chartDate} · Daily result pending (latest: ${context.pendingDailyDate})`
    : `Data date: ${chartDate}`;
  UI.hourlyChartSummary.textContent = hourlyRows.length
    ? `${context.pendingDailyDate ? `Current forecast for ${chartDate}; daily result for ${context.pendingDailyDate} is pending. ` : `Hourly chart for ${chartDate}. `}${hasActual ? 'Actual values are available for completed hours.' : 'Actual values are not yet available.'}`
    : context.pendingDailyDate
    ? `No hourly forecast records are available for the current date ${chartDate}.`
    : 'No hourly records are available for the selected daily date.';

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
function renderTable(hourlyRows, context = {}) {
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
  UI.noActualNote.lastChild.textContent = !hourlyRows.length
    ? context.pendingDailyDate
    ? 'No hourly forecast records are available for the current date'
    : 'No hourly records are available for the selected daily date'
    : hasAny
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

function renderHistory(aiRows, dailyTotalRows = []) {
  const byDate = new Map((aiRows || []).filter(row => row.date).map(row => [row.date, { ...row }]));
  (dailyTotalRows || []).forEach(total => {
    if (!total.date) return;
    const row = byDate.get(total.date) || { date: total.date };
    if (toFloat(row.actual_kwh) === null && toFloat(total.total_kwh) !== null) row.actual_kwh = total.total_kwh;
    if (!row.data_status) row.data_status = 'daily_total_only';
    if (!row.status) row.status = 'daily_total_only';
    byDate.set(total.date, row);
  });
  const allRows = [...byDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const dates = [...new Set(allRows.map(row => row.date).filter(Boolean))];
  if (UI.historyDateSelect) {
    const current = selectedHistoryDate;
    UI.historyDateSelect.textContent = '';
    const allOption = document.createElement('option'); allOption.value = ''; allOption.textContent = 'All days'; UI.historyDateSelect.appendChild(allOption);
    dates.forEach(date => { const option = document.createElement('option'); option.value = date; option.textContent = date; UI.historyDateSelect.appendChild(option); });
    UI.historyDateSelect.value = dates.includes(current) ? current : '';
  }
  const rows = (selectedHistoryDate ? allRows.filter(row => row.date === selectedHistoryDate) : allRows).slice(0, 30);
  UI.historyTableBody.textContent = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    [row.date || '—', row.data_status || (row.status === 'data_incomplete' ? 'daily_total_only' : 'complete'), row.status === 'daily_total_only' ? 'Daily total only' : (row.status || '—'), fmt(row.actual_kwh) ?? 'Pending', fmt(row.prediction_kwh) ?? '—', fmt(rowPredictionError(row)) ?? '—']
      .forEach((value, index) => {
        const td = document.createElement('td');
        td.textContent = value;
        if (index === 2) td.className = String(value).toLowerCase() === 'anomaly' ? 'td-error' : 'td-actual';
        tr.appendChild(td);
      });
    UI.historyTableBody.appendChild(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = 'No completed daily records yet.';
    tr.appendChild(td);
    UI.historyTableBody.appendChild(tr);
  }
}

function renderAnomalyInvestigation(hourlyRows) {
  if (!UI.anomalyInvestigationList) return;
  const rows = (hourlyRows || []).map(row => ({ hour: row.hour, actual: toFloat(row.actual_kwh), expected: toFloat(row.predicted_kwh) }))
    .filter(row => row.actual !== null && row.expected !== null)
    .map(row => ({ ...row, deviation: row.actual - row.expected, percent: row.expected ? ((row.actual - row.expected) / row.expected) * 100 : null }))
    .sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation)).slice(0, 5);
  UI.anomalyInvestigationList.textContent = '';
  if (!rows.length) { const li = document.createElement('li'); li.textContent = 'No completed actual-versus-expected hourly comparisons available.'; UI.anomalyInvestigationList.appendChild(li); return; }
  rows.forEach(row => { const li = document.createElement('li'); const direction = row.deviation >= 0 ? 'above' : 'below'; li.textContent = `${hourLabel(row.hour)}: actual ${row.actual.toFixed(2)} kWh, expected ${row.expected.toFixed(2)} kWh — ${Math.abs(row.deviation).toFixed(2)} kWh (${Math.abs(row.percent || 0).toFixed(1)}%) ${direction} expected.`; UI.anomalyInvestigationList.appendChild(li); });
}

function renderSuggestions(aiRows, hourlyRows) {
  const list = UI.suggestionsList;
  list.textContent = '';
  const suggestions = [];
  const completed = (aiRows || []).filter(row => toFloat(row.actual_kwh) !== null);
  const latest = completed[completed.length - 1];
  if (!completed.length) {
    suggestions.push('Keep the collector running until more complete daily records are available.');
  } else {
    const errors = completed.map(row => toFloat(row.prediction_error_kwh)).filter(v => v !== null);
    if (errors.length) {
      const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
      suggestions.push(mean > 0 ? `Recent forecasts are underestimating by about ${mean.toFixed(2)} kWh on average.`
        : `Recent forecasts are overestimating by about ${Math.abs(mean).toFixed(2)} kWh on average.`);
    }
    if (latest?.status?.toLowerCase() === 'anomaly') suggestions.push(`Review ${latest.date}: the daily profile was flagged as anomalous.`);
    else suggestions.push('The latest completed daily profile is within the learned normal range.');
    if (latest?.anomaly_explanation) suggestions.push(`Profile explanation: ${latest.anomaly_explanation}`);
    if (latest?.profile_mode) suggestions.push(`Forecast profile: ${latest.profile_mode}.`);
  }
  const actuals = (hourlyRows || []).map(row => ({ hour: Number(row.hour), actual: toFloat(row.actual_kwh) }))
    .filter(row => row.actual !== null).sort((a, b) => b.actual - a.actual);
  if (actuals.length) suggestions.push(`Highest completed-hour consumption is around ${hourLabel(actuals[0].hour)} (${actuals[0].actual.toFixed(2)} kWh).`);
  suggestions.push('Use the hourly table to compare completed hours and investigate repeated large errors.');
  for (const text of suggestions) {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  }
}

function renderHealth(stateData, health = {}, dailyTotalRows = []) {
  const lastRun = stateData?.last_run;
  UI.collectorLastRun.textContent = formatISOtoIST(lastRun);
  const recordCount = dailyTotalRows.length || Object.keys(stateData?.profiles || {}).length;
  UI.recordsCount.textContent = `${recordCount} days`;
  const ageMinutes = lastRun ? Math.max(0, Math.round((Date.now() - new Date(lastRun).getTime()) / 60000)) : null;
  const healthy = health.collector_status === 'healthy' && lastRun && ageMinutes < 45;
  UI.collectorHealth.textContent = healthy ? 'Healthy' : 'Needs attention';
  UI.collectorHealth.className = healthy ? 'health-good' : 'health-warn';
  UI.dataFreshness.textContent = ageMinutes === null ? 'Unknown' : `${ageMinutes} min ago`;
  const latency = health.api_latency_ms || {};
  UI.apiLatency.textContent = latency.hourly ? `${latency.hourly} ms` : '—';
  const qualityStatus = health.data_quality?.data_status || health.data_quality?.status || 'unknown';
  const completedHours = health.data_quality?.completed_hours;
  UI.currentDataStatus.textContent = completedHours != null ? `${qualityStatus} · ${completedHours} completed hours` : qualityStatus;
  UI.currentDataStatus.className = qualityStatus === 'complete' ? 'health-good' : 'health-warn';
  const missing = Array.isArray(health.missing_hours) && health.missing_hours.length ? `Missing hours: ${health.missing_hours.join(', ')}.` : 'All returned hours passed validation.';
  const learning = health.learning_samples ?? '—';
  UI.diagnosticStatus.textContent = healthy ? 'Operational' : 'Needs attention';
  UI.diagnosticStatus.className = healthy ? 'health-good' : 'health-warn';
  const quality = health.data_quality?.score != null ? ` Data quality: ${health.data_quality.score}%.` : '';
  const source = health.source ? ` Source: ${health.source}.` : '';
  const learningState = health.learning_status ? ` Learning status: ${health.learning_status}.` : '';
  const timestamps = health.daily_total_collection_at ? ` Daily totals: ${formatISOtoIST(health.daily_total_collection_at)}; payload: ${formatISOtoIST(health.dashboard_payload_generated_at)}.` : '';
  const coverage = health.confidence_coverage?.rate != null ? ` Confidence interval coverage: ${(health.confidence_coverage.rate * 100).toFixed(1)}% (${health.confidence_coverage.evaluated} evaluated).` : '';
  const model = health.model_evaluation?.mae_kwh != null ? ` Model MAE: ${health.model_evaluation.mae_kwh.toFixed(2)} kWh; RMSE: ${health.model_evaluation.rmse_kwh.toFixed(2)} kWh.` : '';
  const rollback = health.rollback_guard?.adaptation_enabled === false ? ' Adaptation rollback guard is active.' : '';
  UI.diagnosticMessage.textContent = `${missing} Automatic calibration has ${learning} completed learning sample${learning === 1 ? '' : 's'}.${quality}${learningState}${source}${timestamps}${coverage}${model}${rollback} ${health.error ? `Last error: ${health.error}` : ''}`.trim();
}

function renderDailyChart(aiRows, dailyTotalRows = []) {
  const byDate = new Map((aiRows || []).filter(row => row.date).map(row => [row.date, { ...row }]));
  (dailyTotalRows || []).forEach(total => {
    if (!total.date) return;
    const row = byDate.get(total.date) || { date: total.date };
    if (toFloat(row.actual_kwh) === null) row.actual_kwh = total.total_kwh;
    byDate.set(total.date, row);
  });
  const rows = [...byDate.values()].filter(row => toFloat(row.actual_kwh) !== null || toFloat(row.prediction_kwh) !== null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-historyDays);
  UI.historyCaption.textContent = `Last ${historyDays} days`;
  UI.dailyChartSummary.textContent = rows.length
    ? `Daily energy history for ${rows[0].date} through ${rows[rows.length - 1].date}, showing actual and forecast values.`
    : 'No daily historical records are available.';
  const chartData = { labels: rows.map(row => row.date), datasets: [
    { label: 'Actual kWh', data: rows.map(row => toFloat(row.actual_kwh)), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.12)', tension: .35, spanGaps: true },
    { label: 'Adapted forecast kWh', data: rows.map(row => toFloat(row.prediction_kwh)), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.10)', tension: .35, spanGaps: true },
    { label: 'Baseline forecast kWh', data: rows.map(row => toFloat(row.base_prediction_kwh)), borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,.08)', borderDash: [6, 4], tension: .35, spanGaps: true },
  ] };
  const options = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#94a3b8' } } }, scales: { x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.05)' } }, y: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,.05)' }, title: { display: true, text: 'Energy (kWh)', color: '#64748b' } } } };
  if (dailyChart) { dailyChart.data = chartData; dailyChart.options = options; dailyChart.update(); }
  else dailyChart = new Chart(document.getElementById('daily-history-chart').getContext('2d'), { type: 'line', data: chartData, options });
}

function renderPerformance(aiRows) {
  const rows = (aiRows || []).map(row => ({ error: toFloat(row.prediction_error_kwh), hourly: toFloat(row.hourly_error_mae) })).filter(row => row.error !== null);
  const abs = rows.map(row => Math.abs(row.error));
  const mae = abs.length ? abs.reduce((a, b) => a + b, 0) / abs.length : null;
  const rmse = abs.length ? Math.sqrt(rows.reduce((sum, row) => sum + row.error ** 2, 0) / rows.length) : null;
  const hourly = rows.map(row => row.hourly).filter(v => v !== null);
  UI.dailyMAE.textContent = mae === null ? '—' : mae.toFixed(2);
  UI.dailyRMSE.textContent = rmse === null ? '—' : rmse.toFixed(2);
  UI.hourlyMAE.textContent = hourly.length ? (hourly.reduce((a, b) => a + b, 0) / hourly.length).toFixed(2) : '—';
  UI.completedDays.textContent = String(rows.length);
  UI.performanceNote.textContent = rows.length >= 3 ? 'Metrics are based on completed forecast cycles.' : 'More completed forecast cycles are needed for reliable performance metrics.';
}

function renderAIImprovement(aiRows, stateData = {}) {
  const completed = (aiRows || []).filter(row => toFloat(row.actual_kwh) !== null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const previous = completed.length ? completed[completed.length - 1] : null;
  const current = currentISTParts();
  const todayProfile = stateData?.profiles?.[current.date] || {};
  const elapsedHours = Math.max(0, current.hour);
  const todayProfileValues = Object.fromEntries(Object.entries(todayProfile).filter(([hour, value]) => Number(hour) < elapsedHours && toFloat(value) !== null));
  const previousProfile = previous ? stateData?.profiles?.[previous.date] || {} : {};
  const commonHours = Object.keys(todayProfileValues).filter(hour => Number(hour) < elapsedHours && toFloat(previousProfile[hour]) !== null);
  const todayValues = commonHours.map(hour => [hour, todayProfileValues[hour]]);
  const previousValues = commonHours.map(hour => [hour, previousProfile[hour]]);
  const todayTotal = todayValues.reduce((sum, [, value]) => sum + Number(value), 0);
  const previousTotal = previousValues.reduce((sum, [, value]) => sum + Number(value), 0);
  const change = previousValues.length && todayValues.length ? ((todayTotal - previousTotal) / Math.max(Math.abs(previousTotal), 1)) * 100 : null;
  const difference = previousValues.length && todayValues.length ? todayTotal - previousTotal : null;
  const todayRate = todayValues.length ? todayTotal / todayValues.length : null;
  const previousRate = previousValues.length ? previousTotal / previousValues.length : null;
  UI.aiLearningStatus.textContent = 'day comparison';
  UI.aiLearningSamples.textContent = String(todayValues.length);
  UI.aiBaselineMae.textContent = previousValues.length ? previousTotal.toFixed(2) : '—';
  UI.aiAdaptedMae.textContent = todayValues.length ? todayTotal.toFixed(2) : '—';
  UI.aiDifferenceKwh.textContent = difference === null ? '—' : `${difference >= 0 ? '+' : ''}${difference.toFixed(2)}`;
  UI.aiImprovementPercent.textContent = change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
  UI.aiRateComparison.textContent = todayRate === null || previousRate === null ? '—' : `${todayRate.toFixed(1)} / ${previousRate.toFixed(1)}`;
  if (!previous || !previousValues.length || !todayValues.length) {
    UI.aiImprovementMessage.textContent = 'Waiting for matching completed hours from today and the previous completed day.';
  } else {
    UI.aiImprovementMessage.textContent = `Like-for-like comparison across ${todayValues.length} elapsed hours: today used ${Math.abs(difference).toFixed(2)} kWh ${difference >= 0 ? 'more' : 'less'} (${Math.abs(change).toFixed(1)}%) than ${previous.date}. Average hourly use is ${todayRate.toFixed(1)} vs ${previousRate.toFixed(1)} kWh/hour.`;
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
    const { aiRows, hourlyRows, dailyTotalRows, stateData, health } = await loadAllData();
    activePayload = { aiRows, hourlyRows, dailyTotalRows, stateData, health };

    const latestAI    = getLatestAiRow(aiRows);
    const selectedAI  = selectedHistoryDate ? aiRows.find(row => row.date === selectedHistoryDate) : null;
    const displayAI   = selectedAI || latestAI;
    const hourlyContext = getHourlyDisplayContext(aiRows, hourlyRows);
    const hourlyToday = hourlyContext.date === currentISTParts().date
      ? mergeLiveActuals(getHourlyForDate(hourlyRows, hourlyContext.date), stateData)
      : getHourlyForDate(hourlyRows, hourlyContext.date);

    renderKPI(displayAI);
    renderAnomalyStrip(displayAI);
    renderChart(hourlyToday, hourlyContext);
    renderTable(hourlyToday, hourlyContext);
    renderAnomalyInvestigation(hourlyToday);
    renderHistory(aiRows, dailyTotalRows);
    renderSuggestions(aiRows, hourlyToday);
    renderHealth(stateData, health, dailyTotalRows);
    renderDailyChart(aiRows, dailyTotalRows);
    renderPerformance(aiRows);
    renderAIImprovement(aiRows, stateData);

    showContent();
  } catch (err) {
    console.error('[EnergyDash] Fetch error:', err);
    try {
      const storedCache = JSON.parse(localStorage.getItem('energy-dashboard-cache') || 'null');
      const cached = storedCache?.data || storedCache;
      const cachedAt = Number(storedCache?.cachedAt || 0);
      const cacheIsFresh = cachedAt > 0 && Date.now() - cachedAt <= CONFIG.cacheMaxAgeMs;
      if (cacheIsFresh && cached?.aiRows?.length) {
        activePayload = cached;
        const latestAI = getLatestAiRow(cached.aiRows);
        const selectedAI = selectedHistoryDate ? cached.aiRows.find(row => row.date === selectedHistoryDate) : null;
        const displayAI = selectedAI || latestAI;
        const hourlyContext = getHourlyDisplayContext(cached.aiRows, cached.hourlyRows);
        const hourlyToday = hourlyContext.date === currentISTParts().date
          ? mergeLiveActuals(getHourlyForDate(cached.hourlyRows, hourlyContext.date), cached.stateData)
          : getHourlyForDate(cached.hourlyRows, hourlyContext.date);
        renderKPI(displayAI);
        renderAnomalyStrip(displayAI);
        renderChart(hourlyToday, hourlyContext);
        renderTable(hourlyToday, hourlyContext);
        renderAnomalyInvestigation(hourlyToday);
        renderHistory(cached.aiRows, cached.dailyTotalRows);
        renderSuggestions(cached.aiRows, hourlyToday);
        renderHealth(cached.stateData, { ...(cached.health || {}), collector_status: 'degraded', source: 'cached payload', error: `${err.message}; showing cached data` }, cached.dailyTotalRows || []);
        renderDailyChart(cached.aiRows, cached.dailyTotalRows);
        renderPerformance(cached.aiRows);
        renderAIImprovement(cached.aiRows, cached.stateData);
        showContent();
        UI.lastUpdated.textContent = `Showing cached data · ${nowIST()} IST`;
        UI.updateDot.className = 'update-dot update-dot--error';
        return;
      }
    } catch (cacheError) {
      console.error('[EnergyDash] Cache error:', cacheError);
    }
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

async function handleDataDownload(event) {
  const link = event.currentTarget;
  const url = link.href;
  const filename = link.getAttribute('download') || url.split('/').pop() || 'energy-data';
  event.preventDefault();
  link.classList.add('is-downloading');
  try {
    const separator = url.includes('?') ? '&' : '?';
    const response = await fetch(`${url}${separator}download=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blobUrl = URL.createObjectURL(await response.blob());
    const downloadLink = document.createElement('a');
    downloadLink.href = blobUrl;
    downloadLink.download = filename;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (error) {
    console.warn('[EnergyDash] Download fallback:', error);
    window.open(url, '_blank', 'noopener');
  } finally {
    link.classList.remove('is-downloading');
  }
}

UI.btnRefresh.addEventListener('click', handleRefreshClick);
UI.btnRetry.addEventListener('click', handleRefreshClick);
UI.historyDateSelect?.addEventListener('change', event => {
  selectedHistoryDate = event.target.value || '';
  refresh();
});
document.querySelectorAll('.range-btn').forEach(button => {
  button.addEventListener('click', () => {
    historyDays = Number(button.dataset.days) || 7;
    document.querySelectorAll('.range-btn').forEach(item => item.classList.toggle('is-active', item === button));
    refresh();
  });
});
document.querySelectorAll('.download-controls a[download]').forEach(link => {
  link.addEventListener('click', handleDataDownload);
});

/* ══════════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════════ */
(function init() {
  refresh().then(scheduleAutoRefresh);
})();

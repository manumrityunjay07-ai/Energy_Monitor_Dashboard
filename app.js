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
    dashboardData:     'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/main/results/dashboard_data.json',
    aiResults:         'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/main/results/ai_results.csv',
    hourlyPredictions: 'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/main/results/hourly_predictions.csv',
    state:             'https://raw.githubusercontent.com/manumrityunjay07-ai/Energy_Monitor_HTTP/main/data/state.json',
  },
  refreshInterval: 5 * 60 * 1000,   // 5 minutes
  timezone:        'Asia/Kolkata',
  maxRetries: 3,
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
  suggestionsList:  $('suggestions-list'),
  collectorHealth:  $('collector-health'),
  collectorLastRun: $('collector-last-run'),
  recordsCount:     $('records-count'),
  dataFreshness:    $('data-freshness'),
  apiLatency:       $('api-latency'),
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
    const normalized = { aiRows: payload.ai_results || [], hourlyRows: payload.hourly_predictions || [], stateData: payload.state || {}, health: { ...(payload.health || {}), source: 'live consolidated payload', generated_at: payload.generated_at } };
    localStorage.setItem('energy-dashboard-cache', JSON.stringify(normalized));
    return normalized;
  } catch (combinedError) {
    const [aiText, hourlyText, stateData] = await Promise.all([
      fetchWithRetry(CONFIG.urls.aiResults),
      fetchWithRetry(CONFIG.urls.hourlyPredictions),
      fetchWithRetry(CONFIG.urls.state, true),
    ]);
    return { aiRows: parseCSV(aiText), hourlyRows: parseCSV(hourlyText), stateData, health: { collector_status: 'legacy payload', source: 'legacy three-file fallback', error: combinedError.message } };
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
  const err = fmt(ai.prediction_error_kwh);
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

function renderHistory(aiRows) {
  const rows = [...(aiRows || [])].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 14);
  UI.historyTableBody.textContent = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    [row.date || '—', row.status || '—', fmt(row.actual_kwh) ?? 'Pending', fmt(row.prediction_kwh) ?? '—', fmt(row.prediction_error_kwh) ?? '—']
      .forEach((value, index) => {
        const td = document.createElement('td');
        td.textContent = value;
        if (index === 1) td.className = String(value).toLowerCase() === 'anomaly' ? 'td-error' : 'td-actual';
        tr.appendChild(td);
      });
    UI.historyTableBody.appendChild(tr);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.textContent = 'No completed daily records yet.';
    tr.appendChild(td);
    UI.historyTableBody.appendChild(tr);
  }
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

function renderHealth(stateData, health = {}) {
  const lastRun = stateData?.last_run;
  UI.collectorLastRun.textContent = formatISOtoIST(lastRun);
  UI.recordsCount.textContent = `${Object.keys(stateData?.profiles || {}).length} days`;
  const ageMinutes = lastRun ? Math.max(0, Math.round((Date.now() - new Date(lastRun).getTime()) / 60000)) : null;
  const healthy = health.collector_status === 'healthy' && lastRun && ageMinutes < 45;
  UI.collectorHealth.textContent = healthy ? 'Healthy' : 'Needs attention';
  UI.collectorHealth.className = healthy ? 'health-good' : 'health-warn';
  UI.dataFreshness.textContent = ageMinutes === null ? 'Unknown' : `${ageMinutes} min ago`;
  const latency = health.api_latency_ms || {};
  UI.apiLatency.textContent = latency.hourly ? `${latency.hourly} ms` : '—';
  const missing = Array.isArray(health.missing_hours) && health.missing_hours.length ? `Missing hours: ${health.missing_hours.join(', ')}.` : 'All returned hours passed validation.';
  const learning = health.learning_samples ?? '—';
  UI.diagnosticStatus.textContent = healthy ? 'Operational' : 'Needs attention';
  UI.diagnosticStatus.className = healthy ? 'health-good' : 'health-warn';
  const quality = health.data_quality?.score != null ? ` Data quality: ${health.data_quality.score}%.` : '';
  const source = health.source ? ` Source: ${health.source}.` : '';
  const learningState = health.learning_status ? ` Learning status: ${health.learning_status}.` : '';
  UI.diagnosticMessage.textContent = `${missing} Automatic calibration has ${learning} completed learning sample${learning === 1 ? '' : 's'}.${quality}${learningState}${source} ${health.error ? `Last error: ${health.error}` : ''}`.trim();
}

function renderDailyChart(aiRows) {
  const rows = [...(aiRows || [])].filter(row => toFloat(row.actual_kwh) !== null || toFloat(row.prediction_kwh) !== null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-historyDays);
  UI.historyCaption.textContent = `Last ${historyDays} days`;
  const chartData = { labels: rows.map(row => row.date), datasets: [
    { label: 'Actual kWh', data: rows.map(row => toFloat(row.actual_kwh)), borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,.12)', tension: .35, spanGaps: true },
    { label: 'Predicted kWh', data: rows.map(row => toFloat(row.prediction_kwh)), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.10)', tension: .35, spanGaps: true },
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
    const { aiRows, hourlyRows, stateData, health } = await loadAllData();

    const latestAI    = getLatestAiRow(aiRows);
    const targetDate  = latestAI ? latestAI.date : null;
    const hourlyToday = mergeLiveActuals(getHourlyForDate(hourlyRows, targetDate), stateData);

    renderKPI(latestAI);
    renderAnomalyStrip(latestAI);
    renderChart(hourlyToday);
    renderTable(hourlyToday);
    renderHistory(aiRows);
    renderSuggestions(aiRows, hourlyToday);
    renderHealth(stateData, health);
    renderDailyChart(aiRows);
    renderPerformance(aiRows);
    renderAIImprovement(aiRows, stateData);

    showContent();
  } catch (err) {
    console.error('[EnergyDash] Fetch error:', err);
    try {
      const cached = JSON.parse(localStorage.getItem('energy-dashboard-cache') || 'null');
      if (cached?.aiRows?.length) {
        const latestAI = getLatestAiRow(cached.aiRows);
        const hourlyToday = mergeLiveActuals(getHourlyForDate(cached.hourlyRows, latestAI?.date), cached.stateData);
        renderKPI(latestAI);
        renderAnomalyStrip(latestAI);
        renderChart(hourlyToday);
        renderTable(hourlyToday);
        renderHistory(cached.aiRows);
        renderSuggestions(cached.aiRows, hourlyToday);
        renderHealth(cached.stateData, { ...(cached.health || {}), collector_status: 'degraded', error: `${err.message}; showing cached data` });
        renderDailyChart(cached.aiRows);
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

UI.btnRefresh.addEventListener('click', handleRefreshClick);
UI.btnRetry.addEventListener('click', handleRefreshClick);
document.querySelectorAll('.range-btn').forEach(button => {
  button.addEventListener('click', () => {
    historyDays = Number(button.dataset.days) || 7;
    document.querySelectorAll('.range-btn').forEach(item => item.classList.toggle('is-active', item === button));
    refresh();
  });
});

/* ══════════════════════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════════════════════ */
(function init() {
  refresh().then(scheduleAutoRefresh);
})();

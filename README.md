# Device 153 — Energy Monitoring Dashboard

A fully static, client-side dashboard for monitoring real-time energy consumption data for **Device 153**. Built with plain HTML, CSS, and JavaScript — no backend, no build step, no API keys.

[![GitHub Pages](https://img.shields.io/badge/Deployed%20on-GitHub%20Pages-blue?logo=github)](https://pages.github.com/)

---

## Live Data Sources

All data is fetched directly from public GitHub raw URLs — no server needed.

| File | URL |
|------|-----|
| Daily AI results | `results/ai_results.csv` |
| Hourly predictions | `results/hourly_predictions.csv` |
| Persistent state | `data/state.json` |

---

## Features

- **KPI Cards** — Today's predicted kWh, actual daily consumption, prediction error, and anomaly status
- **Anomaly Strip** — Score, threshold, hourly MAE, cluster, date, and a live score-vs-threshold progress bar
- **24-Hour Chart** — Predicted, actual, and error values plotted with Chart.js (from CDN)
- **Hourly Table** — Full 0–23 hour breakdown with colour-coded columns
- **Auto Refresh** — All data refreshes automatically every **5 minutes**
- **Refresh Now** — Manual one-click refresh button in the header
- **Loading & Error States** — Spinner during fetch, descriptive error message with retry button
- **Responsive Design** — Works on desktop, tablet, and mobile
- **IST Time Labels** — All timestamps displayed in Asia/Kolkata (UTC+5:30)
- **Secure** — No credentials, no tokens, no secrets anywhere in the code. All data rendered via `textContent` (XSS-safe)

---

## Project Structure

```
Energy_Monitor_Dashboard/
├── index.html   # HTML shell — layout, semantic markup, ARIA roles
├── style.css    # Full dark-theme stylesheet (design tokens, responsive grid)
├── app.js       # Data fetching, CSV parsing, Chart.js rendering, auto-refresh
└── README.md    # This file
```

---

## Deploying to GitHub Pages

1. Push this folder to a GitHub repository (or to the root of an existing repo).
2. Go to **Settings → Pages**.
3. Under **Source**, choose **Deploy from a branch**.
4. Select **main** branch → **/ (root)** folder → **Save**.
5. GitHub Pages will publish the site at `https://<your-username>.github.io/<repo-name>/`.

> **No build step required.** GitHub Pages serves the static files directly.

---

## Local Development

Since the dashboard fetches data via `fetch()` from cross-origin GitHub URLs (which return CORS-friendly headers), you can open `index.html` directly in most browsers. If you prefer a local server:

```bash
# Python (built-in)
python -m http.server 8080

# Node.js (npx)
npx serve .
```

Then open `http://localhost:8080` in your browser.

---

## Data Format Reference

### `ai_results.csv`

| Column | Description |
|--------|-------------|
| `processed_at` | ISO timestamp of when the AI ran |
| `device_id` | Device identifier (153) |
| `date` | Date of the prediction (YYYY-MM-DD) |
| `status` | `normal`, `anomaly`, or waiting state |
| `cluster` | Consumption cluster label |
| `anomaly_score` | Model anomaly score |
| `anomaly_threshold` | Decision threshold |
| `actual_kwh` | Measured daily consumption (may be empty) |
| `prediction_error_kwh` | Actual − Predicted (may be empty) |
| `prediction_kwh` | Today's forward prediction |
| `hourly_error_mae` | Mean absolute hourly error |

### `hourly_predictions.csv`

| Column | Description |
|--------|-------------|
| `processed_at` | ISO timestamp |
| `device_id` | Device identifier |
| `date` | Date (YYYY-MM-DD) |
| `hour` | Hour of day (0–23) |
| `predicted_kwh` | Predicted energy for this hour |
| `actual_kwh` | Measured energy (may be empty) |
| `error_kwh` | Actual − Predicted (may be empty) |

### `state.json`

Historical hourly profiles keyed by date and hour, used by the AI model. The dashboard reads this file but currently uses it as supplementary context.

---

## Security

- **No credentials** are stored or transmitted.
- **No authentication** is required.
- All fetched strings are rendered via `textContent` (never `innerHTML`) to prevent XSS.
- Only public, read-only GitHub raw URLs are accessed.

---

## Technologies

| Tool | Purpose |
|------|---------|
| HTML5 | Semantic markup, ARIA accessibility |
| CSS3 | Custom properties, responsive grid, animations |
| Vanilla JS (ES2020) | Data fetching, CSV parsing, DOM updates |
| [Chart.js](https://www.chartjs.org/) | Hourly line chart (loaded from CDN) |
| [Google Fonts — Inter](https://fonts.google.com/specimen/Inter) | Typography |

---

*Automatically updates every 5 minutes. All times shown in **IST (Asia/Kolkata, UTC+5:30)**.*

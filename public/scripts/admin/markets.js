import { apiBase } from "../app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { app } from "../app.js";

const auth = getAuth(app);

// TradingView's open-source charting library. Loaded only when this section
// is first opened, and pinned with an integrity hash: this page holds an
// admin token, so a tampered CDN copy must not be allowed to run.
const LIBRARY_URL =
  "https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js";
const LIBRARY_INTEGRITY =
  "sha384-OK7vELvjHdhUFi31JYioPIcRHTROLdcDa6ZsNWgvgLaKj+9JqhU0Ad8g4wz3CXjA";

// `key` is the field on each /admin/history point. `scale` and `suffix`
// only change how the value is displayed.
const SYMBOLS = [
  { key: "supply", ticker: "MOOR", name: "Total supply", decimals: 0 },
  { key: "exchangeRate", ticker: "XRATE", name: "Exchange rate", decimals: 4 },
  {
    key: "interestRate",
    ticker: "INT",
    name: "Interest rate",
    decimals: 2,
    scale: 100,
    suffix: "%",
  },
  { key: "users", ticker: "USERS", name: "Users", decimals: 0 },
  { key: "circulating", ticker: "CIRC", name: "Circulating", decimals: 0 },
  { key: "reserve", ticker: "RSRV", name: "Reserve", decimals: 0 },
  { key: "bonded", ticker: "BOND", name: "Bonded", decimals: 0 },
  { key: "redeemed", ticker: "RDMD", name: "Redeemed", decimals: 0 },
];

// Buckets follow local wall-clock time, so "1D" means a school day here
// rather than a UTC day that rolls over mid-afternoon.
const INTERVALS = {
  "1H": {
    start: (d) => d.setMinutes(0, 0, 0),
    step: (d) => d.setHours(d.getHours() + 1),
    intraday: true,
  },
  "4H": {
    start: (d) => d.setHours(Math.floor(d.getHours() / 4) * 4, 0, 0, 0),
    step: (d) => d.setHours(d.getHours() + 4),
    intraday: true,
  },
  "1D": {
    start: (d) => d.setHours(0, 0, 0, 0),
    step: (d) => d.setDate(d.getDate() + 1),
    intraday: false,
  },
  "1W": {
    start: (d) => {
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
    },
    step: (d) => d.setDate(d.getDate() + 7),
    intraday: false,
  },
};

// Bounds memory if the ledger ever spans years on the hourly view.
const MAX_CANDLES = 5000;
// How many candles are in view when a chart first loads.
const INITIAL_VISIBLE = 90;

const COLORS = {
  up: "#26a69a",
  down: "#ef5350",
  flat: "rgba(255, 255, 255, 0.35)",
  upVolume: "rgba(38, 166, 154, 0.45)",
  downVolume: "rgba(239, 83, 80, 0.45)",
  flatVolume: "rgba(255, 255, 255, 0.15)",
  accent: "#fc2",
};

const STORAGE_KEY = "moorecoin:markets";

let Charts = null;
let chart = null;
let candleSeries = null;
let volumeSeries = null;

let history = null;
const aggregated = new Map(); // interval -> { series, volume }

let state = { symbol: "supply", interval: "1D", log: false };

export async function init() {
  restoreState();
  renderIntervalButtons();
  wireToolbar();

  try {
    Charts = await loadLibrary();
  } catch (err) {
    console.error("Failed to load chart library", err);
    setStatus("Couldn't load the chart library.");
    return;
  }

  createChart();
  await loadHistory();
}

export async function onShow() {
  if (chart) await loadHistory();
}

let libraryPromise = null;

function loadLibrary() {
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);

  libraryPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LIBRARY_URL;
    script.integrity = LIBRARY_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(window.LightweightCharts);
    script.onerror = () => {
      libraryPromise = null;
      script.remove();
      reject(new Error("lightweight-charts failed to load"));
    };
    document.head.appendChild(script);
  });

  return libraryPromise;
}

// Per-viewer convenience only, so every access is allowed to fail.
function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (SYMBOLS.some((s) => s.key === saved?.symbol)) state.symbol = saved.symbol;
    if (saved?.interval in INTERVALS) state.interval = saved.interval;
    state.log = saved?.log === true;
  } catch {
    // Keep the defaults.
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked; the selection just won't survive a reload.
  }
}

async function loadHistory() {
  const button = document.getElementById("tv-refresh");
  if (button) button.disabled = true;

  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(`${apiBase}/admin/history`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok)
      throw new Error(`Failed to fetch history (${response.status})`);

    history = await response.json();
    aggregated.clear();

    if (!history.points?.length) {
      setStatus("No activity yet. Charts appear after the first transaction.");
      return;
    }

    setStatus("");
    document.getElementById("tv-updated").textContent =
      `Updated ${new Date(history.now).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}`;
    render({ resetView: true });
  } catch (err) {
    console.error("Failed to load market history", err);
    setStatus("Couldn't load market data.");
  } finally {
    if (button) button.disabled = false;
  }
}

// --- candles ---

// Every symbol is bucketed in one pass, since the watchlist needs all of
// them for the current interval anyway.
//
// The tracked values are a step function — they only change when a ledger
// entry lands — so a candle's open is the previous candle's close, its
// high/low are the extremes reached inside the bucket, and a bucket with no
// activity is a flat candle rather than a gap.
function aggregate(intervalKey) {
  if (aggregated.has(intervalKey)) return aggregated.get(intervalKey);

  const interval = INTERVALS[intervalKey];
  const { start, points, now } = history;
  const series = Object.fromEntries(SYMBOLS.map((s) => [s.key, []]));
  const volume = [];

  const cursor = new Date(points[0].t);
  interval.start(cursor);

  let last = start;
  let i = 0;

  while (cursor.getTime() <= now) {
    const bucketStart = cursor.getTime();
    interval.step(cursor);
    const bucketEnd = cursor.getTime();
    const time = toChartTime(bucketStart);

    const candles = SYMBOLS.map((symbol) => {
      const open = displayValue(symbol, last[symbol.key]);
      return { time, open, high: open, low: open, close: open };
    });

    let coins = 0;
    while (i < points.length && points[i].t < bucketEnd) {
      const point = points[i++];
      coins += point.volume;
      SYMBOLS.forEach((symbol, index) => {
        const value = displayValue(symbol, point[symbol.key]);
        const candle = candles[index];
        candle.high = Math.max(candle.high, value);
        candle.low = Math.min(candle.low, value);
        candle.close = value;
      });
      last = point;
    }

    SYMBOLS.forEach((symbol, index) =>
      series[symbol.key].push(candles[index]),
    );
    volume.push({ time, value: coins });
  }

  for (const key of Object.keys(series)) {
    series[key] = series[key].slice(-MAX_CANDLES);
  }
  const result = { series, volume: volume.slice(-MAX_CANDLES) };
  aggregated.set(intervalKey, result);
  return result;
}

function displayValue(symbol, raw) {
  return (Number(raw) || 0) * (symbol.scale ?? 1);
}

// The library draws times as UTC. Shifting by the local offset makes its
// axis show the viewer's wall clock, matching the local buckets above.
function toChartTime(ms) {
  return (ms - new Date(ms).getTimezoneOffset() * 60_000) / 1000;
}

function direction(candle, previousClose) {
  const reference = previousClose ?? candle.open;
  if (candle.close > reference) return "up";
  if (candle.close < reference) return "down";
  return "flat";
}

// --- chart ---

function createChart() {
  const container = document.getElementById("tv-chart");
  const { CrosshairMode } = Charts;

  chart = Charts.createChart(container, {
    autoSize: true,
    layout: {
      background: { type: "solid", color: "#111" },
      textColor: "rgba(255, 255, 255, 0.55)",
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontSize: 12,
    },
    grid: {
      vertLines: { color: "rgba(255, 255, 255, 0.04)" },
      horzLines: { color: "rgba(255, 255, 255, 0.04)" },
    },
    rightPriceScale: {
      borderColor: "rgba(255, 255, 255, 0.1)",
      scaleMargins: { top: 0.12, bottom: 0.28 },
    },
    timeScale: {
      borderColor: "rgba(255, 255, 255, 0.1)",
      rightOffset: 4,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: "rgba(255, 204, 34, 0.35)", labelBackgroundColor: COLORS.accent },
      horzLine: { color: "rgba(255, 204, 34, 0.35)", labelBackgroundColor: COLORS.accent },
    },
    watermark: {
      visible: true,
      fontSize: 72,
      color: "rgba(255, 255, 255, 0.035)",
      text: "",
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: COLORS.up,
    downColor: COLORS.down,
    wickUpColor: COLORS.up,
    wickDownColor: COLORS.down,
    borderVisible: false,
  });

  volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
    lastValueVisible: false,
    priceLineVisible: false,
  });
  chart.priceScale("volume").applyOptions({
    scaleMargins: { top: 0.8, bottom: 0 },
  });

  chart.subscribeCrosshairMove((param) => {
    const candle = param.time ? param.seriesData.get(candleSeries) : null;
    updateLegend(candle ?? null);
  });
}

let current = null; // { symbol, candles, volume, indexByTime }

function render({ resetView = false } = {}) {
  if (!chart || !history?.points?.length) return;

  const symbol = SYMBOLS.find((s) => s.key === state.symbol);
  const interval = INTERVALS[state.interval];
  const { series, volume } = aggregate(state.interval);
  const raw = series[symbol.key];

  // The library colours close >= open as up, so a bucket with no net change
  // would draw green. Grey it out instead.
  const candles = raw.map((candle, index) =>
    direction(candle, raw[index - 1]?.close) === "flat"
      ? { ...candle, color: COLORS.flat, wickColor: COLORS.flat }
      : candle,
  );

  const volumeBars = volume.map((bar, index) => {
    const dir = direction(raw[index], raw[index - 1]?.close);
    return {
      ...bar,
      color:
        dir === "up"
          ? COLORS.upVolume
          : dir === "down"
            ? COLORS.downVolume
            : COLORS.flatVolume,
    };
  });

  current = {
    symbol,
    candles: raw,
    indexByTime: new Map(raw.map((candle, index) => [candle.time, index])),
    volume,
  };

  candleSeries.applyOptions({ priceFormat: priceFormatFor(symbol) });
  candleSeries.setData(candles);
  volumeSeries.setData(volumeBars);

  chart.applyOptions({
    timeScale: { timeVisible: interval.intraday, secondsVisible: false },
    watermark: { text: symbol.ticker },
  });
  chart.priceScale("right").applyOptions({
    mode: state.log
      ? Charts.PriceScaleMode.Logarithmic
      : Charts.PriceScaleMode.Normal,
  });

  if (resetView) resetVisibleRange();

  updateLegend(null);
  renderWatchlist();
  syncToolbar();
}

function resetVisibleRange() {
  const count = current?.candles.length ?? 0;
  if (count > INITIAL_VISIBLE) {
    chart.timeScale().setVisibleLogicalRange({
      from: count - INITIAL_VISIBLE,
      to: count + 3,
    });
  } else {
    chart.timeScale().fitContent();
  }
}

function priceFormatFor(symbol) {
  const minMove = 1 / 10 ** symbol.decimals;
  return {
    type: "custom",
    minMove,
    formatter: (value) => formatValue(symbol, value),
  };
}

function formatValue(symbol, value) {
  if (!Number.isFinite(value)) return "—";
  return (
    value.toLocaleString(undefined, {
      minimumFractionDigits: symbol.decimals,
      maximumFractionDigits: symbol.decimals,
    }) + (symbol.suffix ?? "")
  );
}

function formatChange(symbol, change, previous) {
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  const absolute = formatValue(symbol, Math.abs(change));
  const percent =
    previous !== 0 ? Math.abs((change / Math.abs(previous)) * 100).toFixed(2) : "0.00";
  return `${sign}${absolute} (${sign}${percent}%)`;
}

// --- legend ---

function updateLegend(hovered) {
  if (!current) return;
  const { symbol, candles, indexByTime, volume } = current;

  document.getElementById("tv-legend-symbol").textContent = symbol.ticker;
  document.getElementById("tv-legend-name").textContent = symbol.name;
  document.getElementById("tv-legend-interval").textContent = state.interval;

  const index = hovered ? indexByTime.get(hovered.time) : candles.length - 1;
  const candle = candles[index];
  const ohlc = document.getElementById("tv-legend-ohlc");
  if (!candle) {
    ohlc.textContent = "";
    return;
  }

  const previousClose = candles[index - 1]?.close ?? candle.open;
  const change = candle.close - previousClose;
  const dir = direction(candle, previousClose);

  ohlc.className = `tv-legend-ohlc is-${dir}`;
  ohlc.replaceChildren(
    ...[
      ["O", formatValue(symbol, candle.open)],
      ["H", formatValue(symbol, candle.high)],
      ["L", formatValue(symbol, candle.low)],
      ["C", formatValue(symbol, candle.close)],
    ].map(([label, value]) => legendItem(label, value)),
    legendItem("", formatChange(symbol, change, previousClose)),
    legendItem("Vol", Math.round(volume[index]?.value ?? 0).toLocaleString(), "is-volume"),
  );
}

function legendItem(label, value, extraClass = "") {
  const item = document.createElement("span");
  item.className = `tv-legend-item ${extraClass}`.trim();
  if (label) {
    const labelEl = document.createElement("span");
    labelEl.className = "tv-legend-label";
    labelEl.textContent = label;
    item.append(labelEl);
  }
  const valueEl = document.createElement("span");
  valueEl.className = "tv-legend-value";
  valueEl.textContent = value;
  item.append(valueEl);
  return item;
}

// --- watchlist ---

function renderWatchlist() {
  const list = document.getElementById("tv-watchlist");
  if (!list || !history?.points?.length) return;

  const { series } = aggregate(state.interval);

  list.replaceChildren(
    ...SYMBOLS.map((symbol) => {
      const candles = series[symbol.key];
      const last = candles[candles.length - 1];
      const previousClose = candles[candles.length - 2]?.close ?? last.open;
      const change = last.close - previousClose;
      const percent =
        previousClose !== 0 ? (change / Math.abs(previousClose)) * 100 : 0;
      const dir = direction(last, previousClose);

      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tv-watchlist-row";
      button.classList.toggle("active", symbol.key === state.symbol);
      button.setAttribute("aria-pressed", String(symbol.key === state.symbol));
      button.addEventListener("click", () => selectSymbol(symbol.key));

      const name = document.createElement("span");
      name.className = "tv-watchlist-symbol";
      const ticker = document.createElement("strong");
      ticker.textContent = symbol.ticker;
      const description = document.createElement("small");
      description.textContent = symbol.name;
      name.append(ticker, description);

      const value = document.createElement("span");
      value.className = "tv-watchlist-last";
      value.textContent = formatValue(symbol, last.close);

      const chg = document.createElement("span");
      chg.className = `tv-watchlist-change is-${dir}`;
      chg.textContent = `${percent > 0 ? "+" : percent < 0 ? "−" : ""}${Math.abs(percent).toFixed(2)}%`;

      button.append(name, value, chg);
      item.append(button);
      return item;
    }),
  );
}

// --- toolbar ---

function renderIntervalButtons() {
  const group = document.getElementById("tv-intervals");
  if (!group) return;

  group.replaceChildren(
    ...Object.keys(INTERVALS).map((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tv-tool";
      button.dataset.interval = key;
      button.textContent = key;
      button.addEventListener("click", () => selectInterval(key));
      return button;
    }),
  );
  syncToolbar();
}

function wireToolbar() {
  document.getElementById("tv-refresh")?.addEventListener("click", () => {
    if (chart) loadHistory();
  });
  document.getElementById("tv-fit")?.addEventListener("click", () => {
    chart?.timeScale().fitContent();
  });
  document.getElementById("tv-log")?.addEventListener("click", () => {
    state.log = !state.log;
    saveState();
    render();
  });
}

function syncToolbar() {
  document.querySelectorAll("#tv-intervals .tv-tool").forEach((button) => {
    const active = button.dataset.interval === state.interval;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const log = document.getElementById("tv-log");
  log?.classList.toggle("active", state.log);
  log?.setAttribute("aria-pressed", String(state.log));
}

function selectSymbol(key) {
  if (key === state.symbol) return;
  state.symbol = key;
  saveState();
  render({ resetView: true });
}

function selectInterval(key) {
  if (key === state.interval) return;
  state.interval = key;
  saveState();
  syncToolbar();
  render({ resetView: true });
}

function setStatus(message) {
  const status = document.getElementById("tv-status");
  if (!status) return;
  status.textContent = message;
  status.hidden = !message;
}

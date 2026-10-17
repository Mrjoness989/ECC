'use strict';

/**
 * Pure technical-analysis helpers for the crypto-day-trader agent.
 *
 * Candles are objects: { time, open, high, low, close, volume } with time in ms.
 * Every function is deterministic and side-effect free so it can be tested
 * against fixtures without network access.
 */

function last(values) {
  return values.length > 0 ? values[values.length - 1] : null;
}

function round(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Wilder's RSI
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff; else loss -= diff;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(diff, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line = values.map((_, i) => (fastEma[i] !== null && slowEma[i] !== null ? fastEma[i] - slowEma[i] : null));
  const start = line.findIndex(v => v !== null);
  const signalLine = new Array(values.length).fill(null);
  if (start !== -1) {
    const compact = ema(line.slice(start), signal);
    compact.forEach((v, i) => { signalLine[start + i] = v; });
  }
  const histogram = line.map((v, i) => (v !== null && signalLine[i] !== null ? v - signalLine[i] : null));
  return { line, signal: signalLine, histogram };
}

function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(null);
  const lower = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    const window = values.slice(i - period + 1, i + 1);
    const variance = window.reduce((acc, v) => acc + (v - mid[i]) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

function atr(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  const out = new Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let prev = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i += 1) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

function stochastic(candles, kPeriod = 14, dPeriod = 3) {
  const k = candles.map((c, i) => {
    if (i < kPeriod - 1) return null;
    const window = candles.slice(i - kPeriod + 1, i + 1);
    const hi = Math.max(...window.map(w => w.high));
    const lo = Math.min(...window.map(w => w.low));
    return hi === lo ? 50 : ((c.close - lo) / (hi - lo)) * 100;
  });
  const start = k.findIndex(v => v !== null);
  const d = new Array(candles.length).fill(null);
  if (start !== -1) {
    sma(k.slice(start), dPeriod).forEach((v, i) => { d[start + i] = v; });
  }
  return { k, d };
}

function obv(candles) {
  const out = [0];
  for (let i = 1; i < candles.length; i += 1) {
    const dir = Math.sign(candles[i].close - candles[i - 1].close);
    out.push(out[i - 1] + dir * candles[i].volume);
  }
  return out;
}

function vwap(candles) {
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
  }
  return vol === 0 ? null : pv / vol;
}

// Swing highs/lows: a bar whose high (low) is the extreme of `span` bars on each side.
function findPivots(candles, span = 3) {
  const highs = [];
  const lows = [];
  for (let i = span; i < candles.length - span; i += 1) {
    const window = candles.slice(i - span, i + span + 1);
    if (candles[i].high === Math.max(...window.map(w => w.high))) highs.push({ index: i, price: candles[i].high });
    if (candles[i].low === Math.min(...window.map(w => w.low))) lows.push({ index: i, price: candles[i].low });
  }
  return { highs, lows };
}

// Cluster nearby pivot prices into levels; strength = number of touches.
function supportResistance(candles, { span = 3, tolerance = 0.006, maxLevels = 4 } = {}) {
  const price = last(candles).close;
  const { highs, lows } = findPivots(candles, span);
  const points = [...highs, ...lows].map(p => p.price).sort((a, b) => a - b);
  const clusters = [];
  for (const p of points) {
    const cluster = last(clusters);
    if (cluster && Math.abs(p - cluster.price) / cluster.price <= tolerance) {
      cluster.touches += 1;
      cluster.price = (cluster.price * (cluster.touches - 1) + p) / cluster.touches;
    } else {
      clusters.push({ price: p, touches: 1 });
    }
  }
  const byDistance = (a, b) => Math.abs(a.price - price) - Math.abs(b.price - price);
  const support = clusters.filter(c => c.price < price).sort(byDistance).slice(0, maxLevels);
  const resistance = clusters.filter(c => c.price > price).sort(byDistance).slice(0, maxLevels);
  return { support, resistance };
}

function fibonacci(candles) {
  const hiIdx = candles.reduce((best, c, i) => (c.high > candles[best].high ? i : best), 0);
  const loIdx = candles.reduce((best, c, i) => (c.low < candles[best].low ? i : best), 0);
  const high = candles[hiIdx].high;
  const low = candles[loIdx].low;
  const upswing = loIdx < hiIdx;
  const range = high - low;
  const ratios = [0.236, 0.382, 0.5, 0.618, 0.786];
  const levels = {};
  for (const r of ratios) {
    levels[r] = upswing ? high - range * r : low + range * r;
  }
  return { direction: upswing ? 'up' : 'down', high, low, levels };
}

function body(c) { return Math.abs(c.close - c.open); }
function range(c) { return c.high - c.low; }
function isBull(c) { return c.close > c.open; }
function isBear(c) { return c.close < c.open; }

function candlestickPatterns(candles) {
  const found = [];
  const n = candles.length;
  if (n < 3) return found;
  const [a, b, c] = candles.slice(-3);
  const r = range(c) || 1e-12;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  if (body(c) / r < 0.1) found.push({ name: 'doji', bias: 'neutral' });
  if (lowerWick >= 2 * body(c) && upperWick <= body(c) * 0.5 && body(c) / r > 0.05) {
    found.push({ name: 'hammer', bias: 'bullish' });
  }
  if (upperWick >= 2 * body(c) && lowerWick <= body(c) * 0.5 && body(c) / r > 0.05) {
    found.push({ name: 'shooting-star', bias: 'bearish' });
  }
  if (isBear(b) && isBull(c) && c.open <= b.close && c.close >= b.open && body(c) > body(b)) {
    found.push({ name: 'bullish-engulfing', bias: 'bullish' });
  }
  if (isBull(b) && isBear(c) && c.open >= b.close && c.close <= b.open && body(c) > body(b)) {
    found.push({ name: 'bearish-engulfing', bias: 'bearish' });
  }
  if (isBear(a) && body(b) < body(a) * 0.4 && isBull(c) && c.close > (a.open + a.close) / 2) {
    found.push({ name: 'morning-star', bias: 'bullish' });
  }
  if (isBull(a) && body(b) < body(a) * 0.4 && isBear(c) && c.close < (a.open + a.close) / 2) {
    found.push({ name: 'evening-star', bias: 'bearish' });
  }
  if ([a, b, c].every(isBull) && b.close > a.close && c.close > b.close) {
    found.push({ name: 'three-white-soldiers', bias: 'bullish' });
  }
  if ([a, b, c].every(isBear) && b.close < a.close && c.close < b.close) {
    found.push({ name: 'three-black-crows', bias: 'bearish' });
  }
  return found;
}

// Structural chart patterns from the last few swing points.
function chartPatterns(candles, { span = 3, tolerance = 0.015 } = {}) {
  const found = [];
  const { highs, lows } = findPivots(candles, span);
  const price = last(candles).close;
  const near = (x, y) => Math.abs(x - y) / ((x + y) / 2) <= tolerance;

  if (highs.length >= 2) {
    const [h1, h2] = highs.slice(-2);
    const trough = Math.min(...candles.slice(h1.index, h2.index + 1).map(c => c.low));
    if (near(h1.price, h2.price) && trough < Math.min(h1.price, h2.price) * (1 - tolerance)) {
      found.push({ name: 'double-top', bias: 'bearish', neckline: trough, confirmed: price < trough });
    }
  }
  if (lows.length >= 2) {
    const [l1, l2] = lows.slice(-2);
    const peak = Math.max(...candles.slice(l1.index, l2.index + 1).map(c => c.high));
    if (near(l1.price, l2.price) && peak > Math.max(l1.price, l2.price) * (1 + tolerance)) {
      found.push({ name: 'double-bottom', bias: 'bullish', neckline: peak, confirmed: price > peak });
    }
  }
  if (highs.length >= 3) {
    const [ls, head, rs] = highs.slice(-3);
    if (head.price > ls.price && head.price > rs.price && near(ls.price, rs.price)) {
      const neckline = Math.min(...candles.slice(ls.index, rs.index + 1).map(c => c.low));
      found.push({ name: 'head-and-shoulders', bias: 'bearish', neckline, confirmed: price < neckline });
    }
  }
  if (lows.length >= 3) {
    const [ls, head, rs] = lows.slice(-3);
    if (head.price < ls.price && head.price < rs.price && near(ls.price, rs.price)) {
      const neckline = Math.max(...candles.slice(ls.index, rs.index + 1).map(c => c.high));
      found.push({ name: 'inverse-head-and-shoulders', bias: 'bullish', neckline, confirmed: price > neckline });
    }
  }
  if (highs.length >= 2 && lows.length >= 2) {
    const [ph, lh] = highs.slice(-2);
    const [pl, ll] = lows.slice(-2);
    const highsFalling = lh.price < ph.price * (1 - tolerance / 3);
    const highsFlat = near(lh.price, ph.price);
    const lowsRising = ll.price > pl.price * (1 + tolerance / 3);
    const lowsFlat = near(ll.price, pl.price);
    if (highsFlat && lowsRising) found.push({ name: 'ascending-triangle', bias: 'bullish' });
    else if (highsFalling && lowsFlat) found.push({ name: 'descending-triangle', bias: 'bearish' });
    else if (highsFalling && lowsRising) found.push({ name: 'symmetrical-triangle', bias: 'neutral' });
  }
  return found;
}

function trend(closes) {
  const e20 = last(ema(closes, 20));
  const e50 = last(ema(closes, 50));
  const e200 = last(ema(closes, 200));
  const price = last(closes);
  if (e20 === null || e50 === null) return { direction: 'unknown', e20, e50, e200 };
  let direction = 'sideways';
  if (price > e20 && e20 > e50 && (e200 === null || e50 > e200)) direction = 'uptrend';
  else if (price < e20 && e20 < e50 && (e200 === null || e50 < e200)) direction = 'downtrend';
  return { direction, e20, e50, e200 };
}

/**
 * Run every indicator over one timeframe and produce a confluence score in [-100, 100].
 * Positive = bullish, negative = bearish. Each signal contributes a weighted vote
 * and is recorded so the agent can explain the reasoning.
 */
function analyzeTimeframe(candles) {
  if (!Array.isArray(candles) || candles.length < 60) {
    throw new Error(`Need at least 60 candles, got ${candles ? candles.length : 0}`);
  }
  const closes = candles.map(c => c.close);
  const price = last(closes);
  const signals = [];
  const vote = (name, weight, detail) => signals.push({ name, weight, detail });

  const t = trend(closes);
  if (t.direction === 'uptrend') vote('trend', 20, 'price > EMA20 > EMA50 (> EMA200)');
  else if (t.direction === 'downtrend') vote('trend', -20, 'price < EMA20 < EMA50 (< EMA200)');

  const r = last(rsi(closes));
  if (r !== null) {
    // In a confirmed trend, extreme RSI signals strength, not reversal: only warn against chasing.
    if (r < 30) vote('rsi', t.direction === 'downtrend' ? 4 : 12, `oversold (${round(r, 1)})`);
    else if (r > 70) vote('rsi', t.direction === 'uptrend' ? -4 : -12, `overbought (${round(r, 1)})`);
    else if (r > 50) vote('rsi', 5, `bullish momentum (${round(r, 1)})`);
    else vote('rsi', -5, `bearish momentum (${round(r, 1)})`);
  }

  const m = macd(closes);
  const hist = m.histogram.filter(v => v !== null);
  const h0 = last(hist);
  const h1 = hist.length > 1 ? hist[hist.length - 2] : null;
  if (h0 !== null && h1 !== null) {
    if (h1 <= 0 && h0 > 0) vote('macd', 15, 'bullish signal-line cross');
    else if (h1 >= 0 && h0 < 0) vote('macd', -15, 'bearish signal-line cross');
    else if (h0 > 0) vote('macd', h0 > h1 ? 8 : 4, 'histogram positive');
    else vote('macd', h0 < h1 ? -8 : -4, 'histogram negative');
  }

  const bb = bollinger(closes);
  const upper = last(bb.upper);
  const lower = last(bb.lower);
  const mid = last(bb.mid);
  const bandwidth = mid ? (upper - lower) / mid : null;
  if (price <= lower) vote('bollinger', 8, 'price at/below lower band (mean-reversion long)');
  else if (price >= upper) vote('bollinger', -8, 'price at/above upper band (mean-reversion short)');

  const st = stochastic(candles);
  const k = last(st.k);
  const d = last(st.d);
  if (k !== null && d !== null) {
    if (k < 20 && k > d) vote('stochastic', 6, `oversold bullish cross (%K ${round(k, 1)})`);
    else if (k > 80 && k < d) vote('stochastic', -6, `overbought bearish cross (%K ${round(k, 1)})`);
  }

  const o = obv(candles);
  const obvSlope = o[o.length - 1] - o[Math.max(0, o.length - 20)];
  const priceSlope = price - closes[Math.max(0, closes.length - 20)];
  if (obvSlope > 0 && priceSlope > 0) vote('obv', 6, 'volume confirms rise');
  else if (obvSlope < 0 && priceSlope < 0) vote('obv', -6, 'volume confirms fall');
  else if (obvSlope > 0 && priceSlope < 0) vote('obv', 5, 'bullish volume divergence');
  else if (obvSlope < 0 && priceSlope > 0) vote('obv', -5, 'bearish volume divergence');

  const vw = vwap(candles.slice(-24));
  if (vw !== null) vote('vwap', price > vw ? 4 : -4, `price ${price > vw ? 'above' : 'below'} rolling VWAP`);

  const candlesFound = candlestickPatterns(candles);
  for (const p of candlesFound) {
    if (p.bias === 'bullish') vote(`candle:${p.name}`, 6, p.name);
    if (p.bias === 'bearish') vote(`candle:${p.name}`, -6, p.name);
  }
  const chartsFound = chartPatterns(candles);
  for (const p of chartsFound) {
    const w = p.confirmed ? 12 : 6;
    if (p.bias === 'bullish') vote(`pattern:${p.name}`, w, `${p.name}${p.confirmed ? ' (confirmed)' : ' (forming)'}`);
    if (p.bias === 'bearish') vote(`pattern:${p.name}`, -w, `${p.name}${p.confirmed ? ' (confirmed)' : ' (forming)'}`);
  }

  const raw = signals.reduce((acc, s) => acc + s.weight, 0);
  const score = Math.max(-100, Math.min(100, raw));
  const a = last(atr(candles));

  return {
    price,
    score,
    signals,
    trend: { direction: t.direction, ema20: round(t.e20), ema50: round(t.e50), ema200: round(t.e200) },
    indicators: {
      rsi: round(r, 2),
      macdHistogram: round(h0, 6),
      bollinger: { upper: round(upper), mid: round(mid), lower: round(lower), bandwidth: round(bandwidth) },
      stochastic: { k: round(k, 2), d: round(d, 2) },
      atr: round(a, 6),
      atrPct: round((a / price) * 100, 3),
      vwap: round(vw),
    },
    levels: supportResistance(candles),
    fibonacci: fibonacci(candles.slice(-100)),
    candlestickPatterns: candlesFound,
    chartPatterns: chartsFound,
  };
}

/**
 * Combine per-timeframe scores (higher timeframes weigh more) with sentiment
 * and produce a day-trade plan sized around a target move (default 3%).
 */
function buildTradePlan(timeframes, { sentimentScore = null, targetPct = 3, riskReward = 1.5 } = {}) {
  const weights = { '15m': 1, '1h': 2, '4h': 3, '1d': 3 };
  let total = 0;
  let weightSum = 0;
  for (const [tf, result] of Object.entries(timeframes)) {
    const w = weights[tf] || 1;
    total += result.score * w;
    weightSum += w;
  }
  const technical = weightSum ? total / weightSum : 0;
  const blended = sentimentScore === null ? technical : technical * 0.8 + sentimentScore * 0.2;
  const composite = Math.max(-100, Math.min(100, blended));
  const ref = timeframes['1h'] || Object.values(timeframes)[0];
  const price = ref.price;
  const atrValue = ref.indicators.atr || price * 0.01;

  let bias = 'no-trade';
  if (composite >= 25) bias = 'long';
  else if (composite <= -25) bias = 'short';

  const agree = Object.values(timeframes).filter(r => Math.sign(r.score) === Math.sign(composite)).length;
  const confidence = Math.round(Math.min(90, Math.abs(composite) * 0.6 + (agree / Object.keys(timeframes).length) * 30));

  const plan = { bias, compositeScore: round(composite, 1), technicalScore: round(technical, 1), confidence, price };
  if (bias === 'no-trade') {
    plan.reason = 'Signals conflict or are too weak; standing aside is a position.';
    return plan;
  }
  const dir = bias === 'long' ? 1 : -1;
  const target = price * (1 + dir * targetPct / 100);
  // Stop: 1.5 ATR, but never wider than target / riskReward so R:R stays acceptable.
  const maxStopDist = (price * targetPct / 100) / riskReward;
  const stopDist = Math.min(atrValue * 1.5, maxStopDist);
  const stop = price - dir * stopDist;
  const atrPct = (atrValue / price) * 100;
  Object.assign(plan, {
    entry: round(price, 6),
    stopLoss: round(stop, 6),
    takeProfit: round(target, 6),
    takeProfitPartial: round(price * (1 + dir * targetPct / 200), 6),
    riskPct: round((stopDist / price) * 100, 2),
    rewardPct: targetPct,
    riskReward: round((price * targetPct / 100) / stopDist, 2),
    targetRealism: atrPct * 4 >= targetPct
      ? 'plausible within a day given current volatility'
      : `stretch: 1h ATR is ${round(atrPct, 2)}%, a ${targetPct}% move needs an unusually strong session`,
  });
  return plan;
}

module.exports = {
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  stochastic,
  obv,
  vwap,
  findPivots,
  supportResistance,
  fibonacci,
  candlestickPatterns,
  chartPatterns,
  trend,
  analyzeTimeframe,
  buildTradePlan,
  round,
};

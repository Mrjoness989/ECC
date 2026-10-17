/**
 * Tests for scripts/lib/crypto-ta.js
 *
 * Run with: node tests/lib/crypto-ta.test.js
 */

const assert = require('assert');
const ta = require('../../scripts/lib/crypto-ta');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function candle(i, open, close, wick = 0.5) {
  return { time: i * 3600000, open, close, high: Math.max(open, close) + wick, low: Math.min(open, close) - wick, volume: 100 };
}

function series(closes) {
  return closes.map((c, i) => candle(i, i === 0 ? c : closes[i - 1], c));
}

// Deterministic trend with a sine wiggle so pivots exist.
function trending(n, start, step) {
  return series(Array.from({ length: n }, (_, i) => start + step * i + Math.sin(i / 3) * 4));
}

function runTests() {
  console.log('\n=== Testing crypto-ta.js ===\n');
  let passed = 0;
  let failed = 0;

  if (test('sma averages the trailing window', () => {
    assert.deepStrictEqual(ta.sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  })) passed++; else failed++;

  if (test('ema seeds with sma then smooths', () => {
    const out = ta.ema([1, 2, 3, 4, 5], 3);
    assert.strictEqual(out[2], 2);
    assert.strictEqual(out[3], 3);
    assert.strictEqual(out[4], 4);
  })) passed++; else failed++;

  if (test('rsi is 100 for a strictly rising series and 0 for falling', () => {
    const up = Array.from({ length: 30 }, (_, i) => i + 1);
    assert.strictEqual(ta.rsi(up)[29], 100);
    assert.strictEqual(ta.rsi(up.slice().reverse())[29], 0);
  })) passed++; else failed++;

  if (test('bollinger bands collapse on a flat series', () => {
    const bb = ta.bollinger(new Array(25).fill(10));
    assert.strictEqual(bb.upper[24], 10);
    assert.strictEqual(bb.lower[24], 10);
  })) passed++; else failed++;

  if (test('atr reflects true range', () => {
    const candles = Array.from({ length: 20 }, (_, i) => ({ open: 10, close: 10, high: 11, low: 9, time: i, volume: 1 }));
    assert.strictEqual(ta.atr(candles)[19], 2);
  })) passed++; else failed++;

  if (test('macd histogram is positive in an accelerating uptrend', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i * i * 0.05);
    const m = ta.macd(closes);
    assert.ok(m.histogram[79] > 0);
  })) passed++; else failed++;

  if (test('detects bullish engulfing', () => {
    const c = [candle(0, 10, 10.2), candle(1, 10.5, 10), candle(2, 9.9, 10.8)];
    const names = ta.candlestickPatterns(c).map(p => p.name);
    assert.ok(names.includes('bullish-engulfing'), names.join(','));
  })) passed++; else failed++;

  if (test('detects hammer', () => {
    const c = [candle(0, 10, 10), candle(1, 10, 10), { time: 2, open: 10, close: 10.2, high: 10.25, low: 9, volume: 1 }];
    assert.ok(ta.candlestickPatterns(c).some(p => p.name === 'hammer'));
  })) passed++; else failed++;

  if (test('detects a double bottom', () => {
    const closes = [];
    for (let i = 0; i < 10; i++) closes.push(110 - i);
    for (let i = 0; i < 10; i++) closes.push(100 + i);
    for (let i = 0; i < 10; i++) closes.push(110 - i);
    for (let i = 0; i < 12; i++) closes.push(100 + i * 1.2);
    const found = ta.chartPatterns(series(closes));
    const db = found.find(p => p.name === 'double-bottom');
    assert.ok(db, JSON.stringify(found));
    assert.strictEqual(db.bias, 'bullish');
    assert.strictEqual(db.confirmed, true);
  })) passed++; else failed++;

  if (test('support sits below and resistance above current price', () => {
    const candles = trending(120, 100, 0.1);
    const { support, resistance } = ta.supportResistance(candles);
    const price = candles[candles.length - 1].close;
    support.forEach(l => assert.ok(l.price < price));
    resistance.forEach(l => assert.ok(l.price > price));
  })) passed++; else failed++;

  if (test('fibonacci retracements lie between swing low and high', () => {
    const fib = ta.fibonacci(trending(100, 100, 0.5));
    assert.strictEqual(fib.direction, 'up');
    Object.values(fib.levels).forEach(v => assert.ok(v > fib.low && v < fib.high));
  })) passed++; else failed++;

  if (test('analyzeTimeframe scores an uptrend bullish and a downtrend bearish', () => {
    const up = ta.analyzeTimeframe(trending(250, 100, 0.8));
    const down = ta.analyzeTimeframe(trending(250, 400, -0.8));
    assert.strictEqual(up.trend.direction, 'uptrend');
    assert.strictEqual(down.trend.direction, 'downtrend');
    assert.ok(up.score > 0, `up score ${up.score}`);
    assert.ok(down.score < 0, `down score ${down.score}`);
  })) passed++; else failed++;

  if (test('analyzeTimeframe rejects short history', () => {
    assert.throws(() => ta.analyzeTimeframe(trending(10, 100, 1)), /at least 60/);
  })) passed++; else failed++;

  if (test('buildTradePlan produces a long plan with a 3% target and bounded stop', () => {
    const tf = ta.analyzeTimeframe(trending(250, 100, 0.8));
    const plan = ta.buildTradePlan({ '15m': tf, '1h': tf, '4h': tf, '1d': tf }, { targetPct: 3 });
    assert.strictEqual(plan.bias, 'long');
    assert.ok(Math.abs(plan.takeProfit / plan.entry - 1.03) < 1e-6);
    assert.ok(plan.stopLoss < plan.entry);
    assert.ok(plan.riskReward >= 1.5 - 1e-9, `rr ${plan.riskReward}`);
  })) passed++; else failed++;

  if (test('buildTradePlan stands aside when timeframes conflict', () => {
    const up = ta.analyzeTimeframe(trending(250, 100, 0.8));
    const down = ta.analyzeTimeframe(trending(250, 400, -0.8));
    const plan = ta.buildTradePlan({ '1h': up, '4h': down }, {});
    assert.strictEqual(plan.bias, 'no-trade');
  })) passed++; else failed++;

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

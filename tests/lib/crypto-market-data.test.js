/**
 * Tests for scripts/lib/crypto-market-data.js and scripts/crypto-analyze.js
 * using a mocked fetch (no network access).
 *
 * Run with: node tests/lib/crypto-market-data.test.js
 */

const assert = require('assert');
const data = require('../../scripts/lib/crypto-market-data');
const { analyze, parseArgs, toMarkdown } = require('../../scripts/crypto-analyze');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function response(body, status = 200) {
  return { ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

function binanceKlines(n) {
  return Array.from({ length: n }, (_, i) => {
    const close = 100 + i * 0.8 + Math.sin(i / 3) * 4;
    const open = close - 0.5;
    return [i * 3600000, String(open), String(close + 1), String(open - 1), String(close), '1000'];
  });
}

const RSS = '<rss><channel><item><title>Fed signals rate cut as inflation eases</title><pubDate>Fri, 16 Oct 2026</pubDate></item>'
  + '<item><title><![CDATA[Bitcoin rally &amp; breakout]]></title></item></channel></rss>';

function mockFetch(overrides = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [needle, handler] of Object.entries(overrides)) {
      if (url.includes(needle)) return handler(url);
    }
    if (url.includes('api.binance.com/api/v3/klines')) {
      const limit = Number(new URL(url).searchParams.get('limit'));
      return response(binanceKlines(Math.min(limit, 300)));
    }
    if (url.includes('fapi.binance.com/fapi/v1/premiumIndex')) return response({ lastFundingRate: '0.0001', markPrice: '300' });
    if (url.includes('fapi.binance.com/fapi/v1/openInterest')) return response({ openInterest: '12345' });
    if (url.includes('scanner.tradingview.com')) return response({ data: [{ d: [0.6, 0.2, -0.05, 0.3, -0.2] }] });
    if (url.includes('alternative.me')) return response({ data: [{ value: '55', value_classification: 'Greed', timestamp: '1760000000' }] });
    if (url.includes('reddit.com')) return response({ data: { children: [{ data: { title: 'BTC bullish breakout incoming', score: 120, num_comments: 40 } }] } });
    if (url.includes('finance.yahoo.com')) return response({ chart: { result: [{ indicators: { quote: [{ close: [100, 102] }] } }] } });
    if (url.includes('.xml') || url.includes('rss')) return response(RSS);
    return response({}, 404);
  };
  fn.calls = calls;
  return fn;
}

async function runTests() {
  console.log('\n=== Testing crypto-market-data.js ===\n');
  let passed = 0;
  let failed = 0;
  const run = async (name, fn) => { if (await test(name, fn)) passed++; else failed++; };

  await run('normalizeSymbol strips quote currencies and rejects junk', () => {
    assert.strictEqual(data.normalizeSymbol('btc'), 'BTC');
    assert.strictEqual(data.normalizeSymbol('SOL/USDT'), 'SOL');
    assert.strictEqual(data.normalizeSymbol('eth-usd'), 'ETH');
    assert.throws(() => data.normalizeSymbol(''), /Invalid coin symbol/);
    assert.throws(() => data.normalizeSymbol('x'), /Invalid coin symbol/);
  });

  await run('fetchCandles falls back to the next exchange on failure', async () => {
    const fetchImpl = mockFetch({
      'api.binance.com': () => response({}, 451),
      'api.bybit.com': () => response({ retCode: 0, result: { list: [['2', '2', '3', '1', '2.5', '9'], ['1', '1', '2', '0.5', '1.5', '8']] } }),
    });
    const { exchange, candles } = await data.fetchCandles('BTC', '1h', { fetchImpl });
    assert.strictEqual(exchange, 'bybit');
    assert.deepStrictEqual(candles.map(c => c.time), [1, 2], 'bybit rows are newest-first and must be reversed');
    assert.strictEqual(candles[1].close, 2.5);
  });

  await run('fetchCandles reports every exchange when all fail', async () => {
    await assert.rejects(data.fetchCandles('BTC', '1h', { fetchImpl: async () => response({}, 500) }), /binance.*bybit.*okx.*kraken.*coinbase/);
  });

  await run('kraken maps BTC to XBT and converts seconds to ms', async () => {
    const fetchImpl = async (url) => {
      assert.ok(url.includes('pair=XBTUSD'));
      return response({ error: [], result: { XXBTZUSD: [[1700000000, '1', '2', '0.5', '1.5', '1.2', '7', 3]], last: 1 } });
    };
    const candles = await data.exchanges.kraken('BTC', '1h', 10, fetchImpl);
    assert.strictEqual(candles[0].time, 1700000000000);
    assert.strictEqual(candles[0].volume, 7);
  });

  await run('parseRssTitles decodes CDATA and entities', () => {
    const items = data.parseRssTitles(RSS);
    assert.strictEqual(items.length, 2);
    assert.strictEqual(items[1].title, 'Bitcoin rally & breakout');
  });

  await run('scoreTexts separates bullish from bearish text', () => {
    assert.ok(data.scoreTexts([{ title: 'Massive rally and breakout, Fed rate cut' }]).score > 0);
    assert.ok(data.scoreTexts([{ title: 'Exchange hack triggers crash and liquidation' }]).score < 0);
    assert.strictEqual(data.scoreTexts([{ title: 'Weekly discussion thread' }]).score, 0);
    assert.strictEqual(data.scoreTexts([{ title: 'shortage of bread' }]).bearishHits, 0, 'word boundaries');
  });

  await run('fearGreedToScore is contrarian at extremes', () => {
    assert.ok(data.fearGreedToScore(10) > 0);
    assert.ok(data.fearGreedToScore(90) < 0);
    assert.ok(data.fearGreedToScore(65) > 0);
  });

  await run('fetchTradingViewRating labels scanner values', async () => {
    const tv = await data.fetchTradingViewRating('BTC', { fetchImpl: mockFetch() });
    assert.ok(tv.ok);
    assert.strictEqual(tv.data['1h'].label, 'strong buy');
    assert.strictEqual(tv.data['1d'].label, 'neutral');
  });

  await run('fetchFredRates is skipped without an API key', async () => {
    const res = await data.fetchFredRates({ apiKey: '', fetchImpl: mockFetch() });
    assert.strictEqual(res.ok, false);
  });

  await run('parseArgs validates target', () => {
    assert.strictEqual(parseArgs(['eth', '--target', '2']).targetPct, 2);
    assert.throws(() => parseArgs(['eth', '--target', 'abc']), /--target/);
  });

  await run('analyze runs end-to-end on mocked data and renders markdown', async () => {
    const result = await analyze('btc', { fetchImpl: mockFetch() });
    assert.strictEqual(result.symbol, 'BTC');
    assert.deepStrictEqual(Object.keys(result.timeframes), ['15m', '1h', '4h', '1d']);
    assert.ok(['long', 'short', 'no-trade'].includes(result.plan.bias));
    assert.ok(result.sentiment.forums.sample > 0);
    assert.ok(result.sentiment.news.fedHeadlines.length > 0);
    const md = toMarkdown(result);
    assert.ok(md.includes('# BTC day-trade analysis'));
    assert.ok(md.includes('TradingView'));
  });

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();

'use strict';

/**
 * Public market, macro, and sentiment data sources for the crypto-day-trader agent.
 *
 * Only unauthenticated public endpoints are used; no API keys are required
 * (FRED is optional via FRED_API_KEY). Every fetcher fails soft: it returns
 * { ok: false, error } instead of throwing so one dead source never sinks
 * the whole analysis. `fetchImpl` is injectable for tests.
 */

const INTERVALS = {
  binance: { '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' },
  bybit: { '15m': '15', '1h': '60', '4h': '240', '1d': 'D' },
  okx: { '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1Dutc' },
  kraken: { '15m': 15, '1h': 60, '4h': 240, '1d': 1440 },
  coinbase: { '15m': 900, '1h': 3600, '4h': null, '1d': 86400 },
};

const USER_AGENT = 'ecc-crypto-day-trader/1.0';

async function getJson(url, fetchImpl, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url, fetchImpl, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function soft(source, fn) {
  try {
    return { source, ok: true, data: await fn() };
  } catch (err) {
    return { source, ok: false, error: err.message };
  }
}

function normalizeSymbol(input) {
  const base = String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(USDT|USDC|USD|PERP)$/, '');
  if (!/^[A-Z0-9]{2,15}$/.test(base)) throw new Error(`Invalid coin symbol: ${input}`);
  return base;
}

function toCandle(time, open, high, low, close, volume) {
  return { time: Number(time), open: +open, high: +high, low: +low, close: +close, volume: +volume };
}

const exchanges = {
  async binance(base, tf, limit, fetchImpl) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${base}USDT&interval=${INTERVALS.binance[tf]}&limit=${limit}`;
    const rows = await getJson(url, fetchImpl);
    return rows.map(r => toCandle(r[0], r[1], r[2], r[3], r[4], r[5]));
  },
  async bybit(base, tf, limit, fetchImpl) {
    const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${base}USDT&interval=${INTERVALS.bybit[tf]}&limit=${limit}`;
    const body = await getJson(url, fetchImpl);
    if (body.retCode !== 0) throw new Error(body.retMsg || 'bybit error');
    return body.result.list.map(r => toCandle(r[0], r[1], r[2], r[3], r[4], r[5])).reverse();
  },
  async okx(base, tf, limit, fetchImpl) {
    const url = `https://www.okx.com/api/v5/market/candles?instId=${base}-USDT&bar=${INTERVALS.okx[tf]}&limit=${Math.min(limit, 300)}`;
    const body = await getJson(url, fetchImpl);
    if (body.code !== '0') throw new Error(body.msg || 'okx error');
    return body.data.map(r => toCandle(r[0], r[1], r[2], r[3], r[4], r[5])).reverse();
  },
  async kraken(base, tf, limit, fetchImpl) {
    const pair = base === 'BTC' ? 'XBTUSD' : `${base}USD`;
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${INTERVALS.kraken[tf]}`;
    const body = await getJson(url, fetchImpl);
    if (body.error && body.error.length) throw new Error(body.error.join(', '));
    const key = Object.keys(body.result).find(k => k !== 'last');
    return body.result[key].slice(-limit).map(r => toCandle(r[0] * 1000, r[1], r[2], r[3], r[4], r[6]));
  },
  async coinbase(base, tf, limit, fetchImpl) {
    const granularity = INTERVALS.coinbase[tf];
    if (!granularity) throw new Error(`coinbase has no ${tf} granularity`);
    const url = `https://api.exchange.coinbase.com/products/${base}-USD/candles?granularity=${granularity}`;
    const rows = await getJson(url, fetchImpl);
    return rows.slice(0, limit).map(r => toCandle(r[0] * 1000, r[3], r[2], r[1], r[4], r[5])).reverse();
  },
};

async function fetchCandles(symbol, tf, { limit = 300, fetchImpl = fetch, order = Object.keys(exchanges) } = {}) {
  const base = normalizeSymbol(symbol);
  const errors = [];
  for (const name of order) {
    try {
      const candles = await exchanges[name](base, tf, limit, fetchImpl);
      if (candles.length > 0) return { exchange: name, candles };
      errors.push(`${name}: empty`);
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  throw new Error(`No exchange returned ${base} ${tf} candles (${errors.join('; ')})`);
}

// Last price on every exchange: shows liquidity spread and any venue dislocation.
async function fetchCrossExchangePrices(symbol, { fetchImpl = fetch } = {}) {
  const base = normalizeSymbol(symbol);
  const results = await Promise.all(Object.keys(exchanges).map(name => soft(name, async () => {
    const candles = await exchanges[name](base, '1h', 2, fetchImpl);
    return candles[candles.length - 1].close;
  })));
  const prices = results.filter(r => r.ok).map(r => ({ exchange: r.source, price: r.data }));
  const values = prices.map(p => p.price);
  const spreadPct = values.length > 1 ? ((Math.max(...values) - Math.min(...values)) / Math.min(...values)) * 100 : 0;
  return { prices, spreadPct, unavailable: results.filter(r => !r.ok).map(r => r.source) };
}

async function fetchDerivatives(symbol, { fetchImpl = fetch } = {}) {
  const base = normalizeSymbol(symbol);
  return soft('binance-futures', async () => {
    const [premium, oi] = await Promise.all([
      getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${base}USDT`, fetchImpl),
      getJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${base}USDT`, fetchImpl),
    ]);
    return {
      fundingRatePct: Number(premium.lastFundingRate) * 100,
      markPrice: Number(premium.markPrice),
      openInterest: Number(oi.openInterest),
    };
  });
}

// TradingView has no official public API; its scanner endpoint powers the
// "Technicals" gauge on tradingview.com and is used here as a second opinion.
async function fetchTradingViewRating(symbol, { fetchImpl = fetch } = {}) {
  const base = normalizeSymbol(symbol);
  return soft('tradingview', async () => {
    const res = await fetchImpl('https://scanner.tradingview.com/crypto/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({
        symbols: { tickers: [`BINANCE:${base}USDT`] },
        columns: ['Recommend.All|60', 'Recommend.All|240', 'Recommend.All', 'Recommend.MA', 'Recommend.Other'],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from scanner.tradingview.com`);
    const body = await res.json();
    const row = body.data && body.data[0];
    if (!row) throw new Error('symbol not found on TradingView scanner');
    const [h1, h4, d1, ma, osc] = row.d;
    return { '1h': ratingLabel(h1), '4h': ratingLabel(h4), '1d': ratingLabel(d1), movingAverages: ratingLabel(ma), oscillators: ratingLabel(osc) };
  });
}

function ratingLabel(value) {
  if (value === null || value === undefined) return { value: null, label: 'n/a' };
  let label = 'neutral';
  if (value >= 0.5) label = 'strong buy';
  else if (value >= 0.1) label = 'buy';
  else if (value <= -0.5) label = 'strong sell';
  else if (value <= -0.1) label = 'sell';
  return { value: Math.round(value * 100) / 100, label };
}

async function fetchFearGreed({ fetchImpl = fetch } = {}) {
  return soft('fear-greed', async () => {
    const body = await getJson('https://api.alternative.me/fng/?limit=7', fetchImpl);
    return body.data.map(d => ({ value: Number(d.value), label: d.value_classification, time: Number(d.timestamp) * 1000 }));
  });
}

// Risk-on/risk-off backdrop: equities, dollar, yields, and BTC dominance proxy.
async function fetchMacroMarkets({ fetchImpl = fetch } = {}) {
  const tickers = { SPY: 'S&P 500', QQQ: 'Nasdaq 100', 'DX-Y.NYB': 'US Dollar Index', '^TNX': 'US 10Y yield', '^IRX': 'US 13W T-bill', COIN: 'Coinbase', MSTR: 'MicroStrategy' };
  const results = await Promise.all(Object.entries(tickers).map(([ticker, name]) => soft(ticker, async () => {
    const body = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`, fetchImpl);
    const closes = body.chart.result[0].indicators.quote[0].close.filter(v => v !== null);
    const lastClose = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    return { name, last: lastClose, changePct: prev ? ((lastClose - prev) / prev) * 100 : null };
  })));
  return results;
}

async function fetchFredRates({ fetchImpl = fetch, apiKey = process.env.FRED_API_KEY } = {}) {
  if (!apiKey) return { source: 'fred', ok: false, error: 'FRED_API_KEY not set (optional)' };
  const series = { DFF: 'Effective Fed Funds', DGS2: '2Y Treasury', DGS10: '10Y Treasury', T10Y2Y: '10Y-2Y spread' };
  return soft('fred', async () => {
    const out = {};
    for (const [id, name] of Object.entries(series)) {
      const body = await getJson(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=5`, fetchImpl);
      const obs = body.observations.filter(o => o.value !== '.');
      out[id] = { name, value: Number(obs[0].value), date: obs[0].date };
    }
    return out;
  });
}

function decodeEntities(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
}

function parseRssTitles(xml, max = 15) {
  const items = [];
  const re = /<item[\s>][\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?(?:<pubDate>([\s\S]*?)<\/pubDate>)?[\s\S]*?<\/item>/g;
  let match;
  while ((match = re.exec(xml)) && items.length < max) {
    items.push({ title: decodeEntities(match[1]), published: match[2] ? match[2].trim() : null });
  }
  return items;
}

const NEWS_FEEDS = {
  'federal-reserve': 'https://www.federalreserve.gov/feeds/press_all.xml',
  coindesk: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  cointelegraph: 'https://cointelegraph.com/rss',
  'cnbc-economy': 'https://www.cnbc.com/id/20910258/device/rss/rss.html',
};

async function fetchNews({ fetchImpl = fetch } = {}) {
  return Promise.all(Object.entries(NEWS_FEEDS).map(([name, url]) => soft(name, async () => parseRssTitles(await getText(url, fetchImpl)))));
}

const FORUMS = ['CryptoCurrency', 'Bitcoin', 'CryptoMarkets', 'wallstreetbets', 'economics'];

async function fetchForumPosts(symbol, { fetchImpl = fetch, coinName = null } = {}) {
  const base = normalizeSymbol(symbol);
  const query = encodeURIComponent(coinName ? `${base} OR ${coinName}` : base);
  return Promise.all(FORUMS.map(sub => soft(`r/${sub}`, async () => {
    const body = await getJson(`https://www.reddit.com/r/${sub}/search.json?q=${query}&restrict_sr=1&sort=new&t=day&limit=25`, fetchImpl);
    return body.data.children.map(c => ({ title: c.data.title, score: c.data.score, comments: c.data.num_comments }));
  })));
}

const BULLISH_WORDS = ['bull', 'bullish', 'moon', 'pump', 'breakout', 'rally', 'surge', 'soar', 'ath', 'all-time high', 'buy', 'long',
  'adoption', 'approval', 'approved', 'etf inflow', 'inflows', 'rate cut', 'cuts rates', 'dovish', 'easing', 'accumulate', 'green', 'gain', 'gains', 'rebound', 'recover'];
const BEARISH_WORDS = ['bear', 'bearish', 'dump', 'crash', 'plunge', 'sell-off', 'selloff', 'sell', 'short', 'liquidation', 'liquidated',
  'hack', 'exploit', 'ban', 'lawsuit', 'sec sues', 'rate hike', 'hikes rates', 'hawkish', 'tightening', 'inflation hot', 'recession', 'outflows', 'red', 'fear', 'drop', 'falls', 'tumble'];

function countHits(text, words) {
  return words.reduce((acc, w) => {
    const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'g');
    return acc + (text.match(re) || []).length;
  }, 0);
}

// Lexicon sentiment in [-100, 100]. weight lets upvoted posts count more.
function scoreTexts(items) {
  let bull = 0;
  let bear = 0;
  for (const item of items) {
    const text = String(item.title || '').toLowerCase();
    const weight = 1 + Math.log10(1 + Math.max(0, item.score || 0));
    bull += countHits(text, BULLISH_WORDS) * weight;
    bear += countHits(text, BEARISH_WORDS) * weight;
  }
  const total = bull + bear;
  return { score: total === 0 ? 0 : Math.round(((bull - bear) / total) * 100), bullishHits: Math.round(bull), bearishHits: Math.round(bear), sample: items.length };
}

function fearGreedToScore(value) {
  // Contrarian at extremes (Buffett: be fearful when others are greedy), trend-following in the middle.
  if (value <= 20) return 30;
  if (value >= 80) return -30;
  return Math.round((value - 50) * 0.6);
}

module.exports = {
  exchanges,
  normalizeSymbol,
  fetchCandles,
  fetchCrossExchangePrices,
  fetchDerivatives,
  fetchTradingViewRating,
  fetchFearGreed,
  fetchMacroMarkets,
  fetchFredRates,
  fetchNews,
  fetchForumPosts,
  parseRssTitles,
  scoreTexts,
  fearGreedToScore,
  ratingLabel,
};

#!/usr/bin/env node
'use strict';

/**
 * Multi-timeframe crypto analysis for the crypto-day-trader agent.
 *
 * Usage:
 *   node scripts/crypto-analyze.js <COIN> [--target 3] [--json] [--no-sentiment] [--name "Solana"]
 *
 * Pulls candles from public exchange APIs (Binance, Bybit, OKX, Kraken, Coinbase
 * with automatic fallback), runs indicators and pattern detection on 15m/1h/4h/1d,
 * blends macro/news/forum sentiment, and prints a day-trade plan. Analysis only:
 * this script never places orders.
 */

const ta = require('./lib/crypto-ta');
const data = require('./lib/crypto-market-data');

const TIMEFRAMES = ['15m', '1h', '4h', '1d'];

function parseArgs(argv) {
  const opts = { symbol: null, targetPct: 3, json: false, sentiment: true, name: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--no-sentiment') opts.sentiment = false;
    else if (arg === '--target') { opts.targetPct = Number(argv[i + 1]); i += 1; }
    else if (arg === '--name') { opts.name = argv[i + 1]; i += 1; }
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (!opts.symbol) opts.symbol = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isFinite(opts.targetPct) || opts.targetPct <= 0 || opts.targetPct > 50) {
    throw new Error('--target must be a percentage between 0 and 50');
  }
  return opts;
}

async function gatherSentiment(symbol, name, fetchImpl) {
  const [fearGreed, news, forums, macro, fred] = await Promise.all([
    data.fetchFearGreed({ fetchImpl }),
    data.fetchNews({ fetchImpl }),
    data.fetchForumPosts(symbol, { fetchImpl, coinName: name }),
    data.fetchMacroMarkets({ fetchImpl }),
    data.fetchFredRates({ fetchImpl }),
  ]);
  const headlines = news.filter(n => n.ok).flatMap(n => n.data.map(item => ({ ...item, source: n.source })));
  const posts = forums.filter(f => f.ok).flatMap(f => f.data.map(p => ({ ...p, source: f.source })));
  const newsScore = data.scoreTexts(headlines);
  const forumScore = data.scoreTexts(posts);
  const fg = fearGreed.ok ? fearGreed.data[0] : null;
  const fgScore = fg ? data.fearGreedToScore(fg.value) : 0;

  const parts = [[newsScore.score, newsScore.sample ? 0.35 : 0], [forumScore.score, forumScore.sample ? 0.35 : 0], [fgScore, fg ? 0.3 : 0]];
  const weight = parts.reduce((a, [, w]) => a + w, 0);
  const score = weight ? Math.round(parts.reduce((a, [s, w]) => a + s * w, 0) / weight) : 0;

  return {
    score,
    fearGreed: fearGreed.ok ? fearGreed.data : null,
    news: { ...newsScore, fedHeadlines: headlines.filter(h => h.source === 'federal-reserve').slice(0, 5), topHeadlines: headlines.slice(0, 10) },
    forums: { ...forumScore, topPosts: posts.sort((a, b) => b.score - a.score).slice(0, 8) },
    macro: macro.filter(m => m.ok).map(m => ({ ticker: m.source, ...m.data })),
    rates: fred.ok ? fred.data : null,
    unavailable: [fearGreed, fred, ...news, ...forums, ...macro].filter(r => !r.ok).map(r => `${r.source}: ${r.error}`),
  };
}

async function analyze(symbol, { targetPct = 3, sentiment = true, name = null, fetchImpl = fetch } = {}) {
  const base = data.normalizeSymbol(symbol);
  const timeframes = {};
  const sources = {};
  for (const tf of TIMEFRAMES) {
    const { exchange, candles } = await data.fetchCandles(base, tf, { fetchImpl });
    sources[tf] = exchange;
    if (candles.length >= 60) timeframes[tf] = ta.analyzeTimeframe(candles);
  }
  if (Object.keys(timeframes).length === 0) throw new Error(`Not enough history to analyze ${base}`);

  const [crossExchange, derivatives, tradingView, mood] = await Promise.all([
    data.fetchCrossExchangePrices(base, { fetchImpl }),
    data.fetchDerivatives(base, { fetchImpl }),
    data.fetchTradingViewRating(base, { fetchImpl }),
    sentiment ? gatherSentiment(base, name, fetchImpl) : Promise.resolve(null),
  ]);

  const plan = ta.buildTradePlan(timeframes, { sentimentScore: mood ? mood.score : null, targetPct });
  return { symbol: base, generatedAt: new Date().toISOString(), sources, plan, timeframes, crossExchange, derivatives, tradingView, sentiment: mood };
}

function fmt(n, d = 4) {
  return n === null || n === undefined ? 'n/a' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
}

function toMarkdown(r) {
  const p = r.plan;
  const lines = [`# ${r.symbol} day-trade analysis`, '', `Generated ${r.generatedAt}. Analysis only, not financial advice.`, ''];
  lines.push(`## Verdict: **${p.bias.toUpperCase()}** (score ${p.compositeScore}, confidence ${p.confidence}%)`, '');
  if (p.bias === 'no-trade') lines.push(p.reason, '');
  else {
    lines.push(`| Entry | Stop | TP1 (half) | TP2 | Risk | Reward | R:R |`, '|---|---|---|---|---|---|---|');
    lines.push(`| ${fmt(p.entry)} | ${fmt(p.stopLoss)} | ${fmt(p.takeProfitPartial)} | ${fmt(p.takeProfit)} | ${p.riskPct}% | ${p.rewardPct}% | ${p.riskReward} |`, '');
    lines.push(`Target realism: ${p.targetRealism}`, '');
  }
  lines.push('## Timeframes', '', '| TF | Exchange | Score | Trend | RSI | ATR% | Patterns |', '|---|---|---|---|---|---|---|');
  for (const [tf, t] of Object.entries(r.timeframes)) {
    const pats = [...t.chartPatterns, ...t.candlestickPatterns].map(x => x.name).join(', ') || '-';
    lines.push(`| ${tf} | ${r.sources[tf]} | ${t.score} | ${t.trend.direction} | ${fmt(t.indicators.rsi, 1)} | ${fmt(t.indicators.atrPct, 2)} | ${pats} |`);
  }
  const h1 = r.timeframes['1h'] || Object.values(r.timeframes)[0];
  lines.push('', '## Key levels (1h)', '');
  lines.push(`- Resistance: ${h1.levels.resistance.map(l => `${fmt(l.price)} (${l.touches}x)`).join(', ') || 'none nearby'}`);
  lines.push(`- Support: ${h1.levels.support.map(l => `${fmt(l.price)} (${l.touches}x)`).join(', ') || 'none nearby'}`);
  lines.push(`- Fibonacci (${h1.fibonacci.direction}swing): ${Object.entries(h1.fibonacci.levels).map(([k, v]) => `${k}=${fmt(v)}`).join(', ')}`);
  lines.push('', '## Signals (1h)', '', ...h1.signals.map(s => `- ${s.weight > 0 ? '+' : ''}${s.weight} ${s.name}: ${s.detail}`));
  if (r.tradingView.ok) {
    const tv = r.tradingView.data;
    lines.push('', `## TradingView technicals`, '', `1h ${tv['1h'].label}, 4h ${tv['4h'].label}, 1d ${tv['1d'].label} (MAs ${tv.movingAverages.label}, oscillators ${tv.oscillators.label})`);
  }
  lines.push('', '## Market structure', '');
  lines.push(`- Cross-exchange: ${r.crossExchange.prices.map(x => `${x.exchange} ${fmt(x.price)}`).join(', ')} (spread ${fmt(r.crossExchange.spreadPct, 3)}%)`);
  if (r.derivatives.ok) lines.push(`- Funding ${fmt(r.derivatives.data.fundingRatePct, 4)}%, open interest ${fmt(r.derivatives.data.openInterest, 0)}`);
  if (r.sentiment) {
    const s = r.sentiment;
    lines.push('', `## Sentiment: ${s.score}`, '');
    if (s.fearGreed) lines.push(`- Fear & Greed: ${s.fearGreed[0].value} (${s.fearGreed[0].label})`);
    lines.push(`- News: ${s.news.score} over ${s.news.sample} headlines; forums: ${s.forums.score} over ${s.forums.sample} posts`);
    if (s.rates) lines.push(`- Rates: ${Object.values(s.rates).map(x => `${x.name} ${x.value}`).join(', ')}`);
    for (const m of s.macro) lines.push(`- ${m.name}: ${fmt(m.last, 2)} (${fmt(m.changePct, 2)}%)`);
    for (const h of s.news.fedHeadlines) lines.push(`- Fed: ${h.title}`);
    if (s.unavailable.length) lines.push(`- Unavailable: ${s.unavailable.join('; ')}`);
  }
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.symbol) {
    console.log('Usage: node scripts/crypto-analyze.js <COIN> [--target 3] [--json] [--no-sentiment] [--name "Full Name"]');
    process.exit(opts.help ? 0 : 1);
  }
  const result = await analyze(opts.symbol, opts);
  console.log(opts.json ? JSON.stringify(result, null, 2) : toMarkdown(result));
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[crypto-analyze] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { analyze, parseArgs, toMarkdown };

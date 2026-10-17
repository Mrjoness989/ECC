---
name: crypto-day-trading
description: Trading theory and a repeatable workflow for crypto day trading. Covers multi-timeframe technical analysis, indicators, candlestick and chart patterns, Dow, Elliott, and Wyckoff theory, Fibonacci, volume, derivatives data, US rates and macro, sentiment, and risk management. Use when analyzing a coin, building a trade plan, or interpreting output from scripts/crypto-analyze.js.
metadata:
  origin: ECC
---

# Crypto Day Trading

A trade needs a reason, a level, and an exit before it needs an entry.

## When to Use

- the user asks about a coin, a prediction, or a day-trade setup
- interpreting `node scripts/crypto-analyze.js <COIN> --json` output
- judging whether a 3% intraday target is realistic today
- weighing macro news (Fed, CPI, yields) against a chart signal

## How It Works

### 1. Top-down timeframes

| Timeframe | Job |
|-----------|-----|
| 1d | Primary trend and major levels. Never fight it on a day trade without a clear reversal pattern. |
| 4h | Swing structure: higher highs/higher lows or lower highs/lower lows. |
| 1h | Setup: pattern, level test, momentum shift. |
| 15m | Trigger: entry candle, tight stop placement. |

The script weights 1d and 4h at 3, 1h at 2, and 15m at 1 when it builds the composite score.

### 2. Market theories

- **Dow theory**: a trend holds until the market gives a clear reversal signal. An uptrend is higher highs and higher lows. Volume should confirm the trend.
- **Elliott waves**: impulse moves come in five waves, corrections in three (A-B-C). Wave 3 is usually the longest and is the best one to ride. Wave 5 shows divergence. Use it for context only; wave counts are subjective.
- **Wyckoff**: accumulation (a range after a downtrend, ending in a spring below support and then a sign of strength), then markup, distribution (a range after an uptrend, ending in an upthrust), then markdown. Watch for volume climaxes at the edges of the range.
- **Trend following vs mean reversion**: in a trend (price aligned with EMA20 > EMA50 > EMA200) buy pullbacks to the EMA20 or EMA50. In a range (flat EMAs, narrow Bollinger bandwidth) fade the edges. Do not mix the two.
- **Market cycle / BTC dominance**: altcoins usually follow BTC. When BTC dominance rises, alts underperform. Check BTC before calling an alt.

### 3. Indicators (what the script computes)

| Indicator | Bullish | Bearish | Notes |
|-----------|---------|---------|-------|
| EMA 20/50/200 | stacked up, price above | stacked down, price below | the main trend filter |
| RSI(14) | < 30, or holding > 50 | > 70, or failing at 50 | in strong trends extremes mean strength; look for divergence |
| MACD(12,26,9) | histogram crosses above 0 | histogram crosses below 0 | a cross near zero is stronger |
| Bollinger(20,2) | tag lower band in a range | tag upper band in a range | a squeeze (low bandwidth) comes before a breakout |
| Stochastic(14,3) | %K crosses up below 20 | %K crosses down above 80 | timing tool only |
| OBV | rising with price, or rising while price falls (divergence) | the reverse | volume comes before price |
| VWAP | price above | price below | the intraday fair value that institutions anchor to |
| ATR(14) | — | — | sizes stops; ATR% shows whether a 3% move is plausible |

### 4. Patterns

Candles (on the last 3 bars): hammer, shooting star, doji, bullish/bearish engulfing, morning/evening star, three white soldiers, three black crows. A candle only counts at a level.

Chart patterns (from swing pivots): double top/bottom, head and shoulders (and inverse), ascending/descending/symmetrical triangles. The script marks each one `confirmed` once price closes through the neckline. Unconfirmed patterns get half weight. The measured-move target is the pattern height projected from the breakout.

Levels: support and resistance come from clustered swing pivots, and more touches make a level stronger. Fibonacci retracements of the last swing: 0.382 to 0.618 is the "golden pocket" where trend pullbacks often end.

### 5. Derivatives and market structure

- **Funding rate**: above +0.05% per 8h means longs are crowded and squeeze risk is down; below -0.05% means shorts are crowded.
- **Open interest**: rising OI with rising price means new longs and a healthy trend. Rising OI with falling price means new shorts. Falling OI means positions are closing (short covering or long liquidation).
- **Cross-exchange spread**: above 0.3% points to stress or thin liquidity on one venue. Avoid it.

### 6. Macro: US rates

- Rate cuts or dovish Fed language increase liquidity, which is bullish for crypto. Hikes or hawkish language are bearish.
- Rising 10Y yields and a rising DXY tighten conditions and usually weigh on BTC.
- Equities: BTC has traded with the Nasdaq (QQQ) in risk-off periods. A falling QQQ lowers confidence in longs.
- Event risk: do not open new day trades in the hour before FOMC, CPI, PCE, or NFP. Volatility spikes both ways and stops get run.
- Check the CME FedWatch probabilities. The surprise relative to expectations moves markets, not the decision itself.

### 7. Sentiment

- Fear & Greed is contrarian at the extremes (below 20 favors buying, above 80 favors caution) and trend-confirming in between.
- Forum and news tone come from a keyword score weighted by upvotes. It is noisy, so use it as a tiebreaker, never as the main signal.
- Euphoria on r/CryptoCurrency or r/wallstreetbets near resistance is a warning sign, not confirmation.

### 8. Risk management (non-negotiable)

- Risk at most 1% of the account per trade. Size = (account x 0.01) / |entry - stop|.
- Minimum risk/reward is 1.5. Take half off at +1.5% and move the stop to breakeven, then let the rest run to +3%.
- Daily stop: after -2% on the day, stop trading.
- Most days have no good 3% setup. "No trade" is a valid and frequent answer. No strategy guarantees a daily return, and leverage multiplies losses as fast as gains.

## Examples

### Asking about a coin

```text
/coin SOL
```

The agent runs `node scripts/crypto-analyze.js SOL --json`, searches for today's macro calendar, and replies:

```markdown
## SOL — LONG (confidence 62%)

| Entry | Stop | TP1 (close half) | TP2 | R:R |
|---|---|---|---|---|
| 182.40 | 178.75 | 185.14 | 187.87 | 1.5 |

**Why**
- Trend (4h/1d): EMAs stacked bullish, higher lows since Monday
- Momentum: 1h MACD crossed up, RSI 58
- Levels and patterns: bounced off 180 support (3 touches), ascending triangle on 4h
- Funding +0.01%, OI rising with price
- TradingView: 1h buy, 4h strong buy
- Macro: no high-impact release today; DXY softer
- Sentiment: Fear & Greed 61 (Greed), forums mildly bullish

**Invalidation**: a 1h close below 178.
```

### Charts only, custom target

```bash
node scripts/crypto-analyze.js ETH --target 2 --no-sentiment
```

### Optional rates data

Set `FRED_API_KEY` (free from the St. Louis Fed) to add Fed Funds, 2Y, 10Y, and the 10Y-2Y spread to the sentiment block.

## Related

- `llm-trading-agent-security` before giving any agent order-placement authority
- `market-research` for longer-horizon fundamental research on a project

---
description: Chart-based day-trade prediction for a crypto coin using multi-exchange data, TradingView ratings, US rates news, and forum sentiment.
argument-hint: <COIN> [--target <pct>]
---

# Coin Analysis

**Input**: $ARGUMENTS

Delegate to the `crypto-day-trader` agent with the coin symbol and any options from the input. If no symbol was given, ask which coin to analyze.

The agent should:

1. Run `node scripts/crypto-analyze.js <COIN> --json` (pass through `--target` if given).
2. Add same-day context with web search: FOMC and US rate expectations, scheduled CPI/PCE/jobs releases, coin-specific catalysts.
3. Apply the `crypto-day-trading` skill to reach a verdict.
4. Reply in the agent's output format: verdict, entry/stop/targets table, reasons, invalidation, and the not-financial-advice note.

Analysis only. This command never places orders.

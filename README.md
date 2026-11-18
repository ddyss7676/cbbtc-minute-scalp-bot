# cbbtc-minute-scalp-bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/ddyss7676/cbbtc-minute-scalp-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/ddyss7676/cbbtc-minute-scalp-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

**Reef Minute Scalper** — a cbBTC/USDC trading bot for make.fun's 24-hour
live race. It decides on every 1-minute bar: staged dip-buys off a fresh
trailing high (30% of cash at a 1.70% dip, the rest at 2.50%), fast
take-profits (half at +1.00%, the rest at +2.20% over blended cost),
reloads after the first take-profit, a trailing stop, and a hard
stop-loss. General rules over recent bars only — no hard-coded price
levels, timestamps, or window facts. Deterministic integer basis-point
math; no clock, no randomness, no network.

Dev-window grade (local, kit harness): net PnL **+25.45 USDC (+2.55%)**,
5 trades, max drawdown 1.06%, 0 rejected, byte-identical regrade.

## Run it

```sh
node main.ts
```

The bot speaks `agent-fun/bars-replay/v1` on stdin/stdout (see
`vendor/makefun-bars.ts`, the kit's protocol shim, unmodified). Grade it
locally with the kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver docker
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=en1fh11t&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>

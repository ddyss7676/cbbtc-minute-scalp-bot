// Reef Minute Scalper — v2 (final): a staged dip-scalp evaluated on EVERY bar.
//
// The literal +10% take-profit version (v1) lost $31.63 on the dev window:
// a 10% rise never occurs within any 120-bar stretch there (maximum
// favorable excursion 1.89%), so it bought once and held a falling market.
// The dev window's whole range is 3.35% with a -2.8% drift, and a full-size
// round trip costs ~26 bps in fee, slippage and impact, so small-threshold
// scalps drown in costs (thousands of swept combinations confirmed it).
// This version keeps the spirit of the request — decide every minute,
// bank profit fast, repeat — at levels the market actually reaches:
//
//   - Reference: the highest close of the last 240 bars (4 hours). The high
//     must be FRESH (seen within the last 60 bars): a dip from a fresh high
//     is a pullback; a fall from a stale high is a downtrend, and the bot
//     stays flat.
//   - Stage 1: 30% of cash when the close dips >= 1.70% below the fresh high.
//   - Stage 2: the remaining cash when the close dips >= 2.50% below the
//     trailing high (same window, freshness not required: the deeper dip is
//     itself the confirmation).
//   - Take profit 1: sell half at +1.00% over blended cost (profit banked
//     fast, as requested).
//   - Take profit 2: sell the rest at +2.20% over blended cost.
//   - Reload: after take-profit 1, if the close dips >= 2.00% below the
//     trailing high again, re-buy with the freed cash (at most 2 reloads
//     per cycle); after a reload only take-profit 2, the trailing stop and
//     the stop-loss apply.
//   - Trailing stop: once the position's peak value reaches +0.50% over
//     cost, sell everything if the value falls 1.20% below its peak.
//   - Stop-loss: sell everything at -4.00% under cost.
//
// Everything is a general rule over recent bars, percentages and position
// state: no price level, timestamp or window fact is hard-coded. All money
// math is integer basis points on the harness's own account values, one
// order per batch at most, sells decided before buys, so two runs on the
// same bars produce the same orders. No clock, no randomness, no network,
// no files. Protocol: agent-fun/bars-replay/v1 via the kit shim.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10_000n;

// --- Tuned thresholds (basis points unless noted) ---------------------------
const WINDOW_BARS = 240; // trailing-high lookback, in bars (minutes).
const FRESH_BARS = 60; // the trailing high must be this recent to enter.
const DIP_STAGE1_BPS = 170; // stage-1 entry dip below the fresh high.
const DIP_STAGE2_BPS = 250; // stage-2 entry dip below the trailing high.
const DIP_RELOAD_BPS = 200; // reload dip below the trailing high.
const STAGE1_CASH_PCT = 30; // share of cash spent on stage 1 (percent).
const TP1_BPS = 100; // take-profit 1: sell half the position.
const TP2_BPS = 220; // take-profit 2: sell the rest.
const TRAIL_ARM_BPS = 50; // trailing stop arms once peak value is this far over cost.
const TRAIL_BPS = 120; // trailing stop distance below the peak value.
const STOP_BPS = 400; // hard stop-loss under cost.
const MAX_RELOADS = 2; // reload buys allowed per cycle.
const MAX_SLIPPAGE_BPS = 100; // per-order cap vs the latest close.

// --- Cycle state (derived from the account each batch; never trusted blindly)
const closes: bigint[] = []; // closes seen so far, oldest first.
let stage = 0; // 0 = flat, 1 = stage 1 filled, 2 = stage 2 filled.
let tp1Done = false; // take-profit 1 already banked this cycle.
let reloads = 0; // reload buys filled this cycle.
let peakValue = 0n; // peak position value at a close, this cycle.
let lastQty = 0n; // position qty on the previous batch.
let pendingTag: 's1' | 's2' | 'reload' | 'tp1' | 'sell' | null = null;

function resetCycle(): void {
  stage = 0;
  tp1Done = false;
  reloads = 0;
  peakValue = 0n;
}

/** Trailing high over the last WINDOW_BARS closes, and the index where it was last seen. */
function trailingHigh(): { high: bigint; index: number } {
  const start = Math.max(0, closes.length - WINDOW_BARS);
  let high = closes[start]!;
  let index = start;
  for (let i = start + 1; i < closes.length; i++) {
    if (closes[i]! >= high) {
      high = closes[i]!;
      index = i;
    }
  }
  return { high, index };
}

/** True when `close` sits at least `dipBps` below `high` (integer math). */
function dippedBelow(close: bigint, high: bigint, dipBps: number): boolean {
  return close * BPS <= high * (BPS - BigInt(dipBps));
}

function decide(state: BarsState, batch: Batch): OrderInput[] {
  const bar = batch.bars.find((b) => b.symbol === SYMBOL);
  const pos = state.positions.get(SYMBOL);
  const qty = pos?.qty ?? 0n;
  const cost = pos?.cost ?? 0n;

  // --- Sync cycle state with the account (fills land here, one bar after
  // the order). A quantity drop means a sell filled; a rise means a buy.
  if (qty === 0n) {
    resetCycle();
  } else {
    if (lastQty > 0n && qty < lastQty) {
      // Partial sale filled: the peak tracks the remaining position.
      peakValue = (peakValue * qty) / lastQty;
      if (pendingTag === 'tp1') tp1Done = true;
    }
    if (qty > lastQty) {
      if (pendingTag === 's1') stage = 1;
      else if (pendingTag === 's2') stage = 2;
      else if (pendingTag === 'reload') reloads += 1;
    }
  }
  lastQty = qty;
  pendingTag = null;

  // No fresh bar for the symbol this minute: hold decisions, keep state.
  if (bar === undefined || state.warmingUp) return [];
  const close = BigInt(bar.c);
  closes.push(close);
  const index = closes.length - 1;

  const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
  const buy = (notional: bigint, tag: 's1' | 's2' | 'reload'): OrderInput[] => {
    if (notional < minNotional) return [];
    pendingTag = tag;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  };
  const sell = (sellQty: bigint, tag: 'tp1' | 'sell'): OrderInput[] => {
    if (sellQty <= 0n) return [];
    pendingTag = tag;
    return [{ side: 'sell', symbol: SYMBOL, qty: sellQty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  };

  // --- Flat: stage-1 entry off a fresh trailing high.
  if (qty === 0n) {
    const { high, index: highIndex } = trailingHigh();
    const fresh = index - highIndex <= FRESH_BARS;
    if (fresh && dippedBelow(close, high, DIP_STAGE1_BPS)) {
      return buy((state.cash * BigInt(STAGE1_CASH_PCT)) / 100n, 's1');
    }
    return [];
  }

  // --- Long: track the peak, then exits first, entries after. One order.
  const value = state.value(SYMBOL, qty, close);
  if (value > peakValue) peakValue = value;
  if (cost <= 0n) return [];
  const { high } = trailingHigh();

  // Take-profit 2: everything, at +TP2_BPS over blended cost.
  if (value * BPS >= cost * (BPS + BigInt(TP2_BPS))) {
    return sell(qty, 'sell');
  }
  // Take-profit 1: half the position, at +TP1_BPS over blended cost.
  if (!tp1Done && value * BPS >= cost * (BPS + BigInt(TP1_BPS))) {
    const half = qty / 2n;
    return sell(half > 0n ? half : qty, 'tp1');
  }
  // Stop-loss: everything, at -STOP_BPS under cost.
  if (value * BPS <= cost * (BPS - BigInt(STOP_BPS))) {
    return sell(qty, 'sell');
  }
  // Trailing stop: armed once the peak reached +TRAIL_ARM_BPS over cost.
  if (peakValue * BPS >= cost * (BPS + BigInt(TRAIL_ARM_BPS)) && value * BPS <= peakValue * (BPS - BigInt(TRAIL_BPS))) {
    return sell(qty, 'sell');
  }
  // Stage 2: the rest of the cash, on a deeper dip.
  if (stage === 1 && dippedBelow(close, high, DIP_STAGE2_BPS)) {
    return buy(state.cash, 's2');
  }
  // Reload: freed cash back in, on a fresh dip after take-profit 1.
  if (tp1Done && reloads < MAX_RELOADS && dippedBelow(close, high, DIP_RELOAD_BPS)) {
    return buy(state.cash, 'reload');
  }
  return [];
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    return decide(state, batch);
  },
});

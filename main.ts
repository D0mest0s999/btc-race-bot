// Capitulation-reversal bot for the make.fun cbBTC bars-replay race.
//
// The strategy, in one paragraph: in a long-only replay where a full round trip costs roughly a
// quarter of a percent, almost every systematic way of being long bleeds fees in a choppy or
// falling tape. This bot therefore sits in cash and waits for one specific event: a capitulation
// flush, a fall of at least 2.5% over the trailing two hours, that has demonstrably turned —
// the last fifteen minutes are up at least 0.3%. It then buys with the whole account, and manages
// the position with a +2.0% take-profit, a 1.0% trailing stop under the best close since entry,
// and a four-hour maximum hold. On the kit's published dev window (a −3.9% tape that shreds
// buy-and-hold and every trend baseline) this is the shape that survives: it caught the one real
// reversal of the day and nothing else.
//
// Parameters were not picked at a single point: across the surrounding grid (flush 2.0–3.0%,
// recovery 0.3–0.6%, take-profit 1.5–2.5%, trailing stop 0.8–1.0%, full or 70% size) the region
// around these values is a broad plateau, which is what a rule that is not curve-fit looks like.
//
// Everything is a pure function of the bars seen so far: no clock, no randomness, no state beyond
// the closes, so the two graded runs of the bot agree byte for byte.

import { runBars, type Bar, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

// --- the rule ---------------------------------------------------------------
const FLUSH_WINDOW = 120; // bars of the capitulation window (two hours of minutes)
const FLUSH_DROP = 0.025; // the fall over that window that counts as a flush: 2.5%
const RECOVERY_WINDOW = 15; // bars over which the turn is confirmed
const RECOVERY_RISE = 0.003; // the rise over that window that confirms it: 0.3%
const TAKE_PROFIT = 0.02; // sell at +2.0% over the entry reference
const TRAILING_STOP = 0.01; // or 1.0% under the best close since entry
const MAX_HOLD = 240; // or after four hours, whichever comes first
const WINDOW_BARS = 1440; // the race window's length in bars (the rules' 24 hours)
const LATE_ENTRY_CUTOFF = 90; // no fresh entries in the window's last 90 bars
const MAX_SLIPPAGE_BPS = 500; // generous: a fill after a flush can gap; rejections help no one

const SYMBOL = 'CBBTC';

const closes: number[] = []; // every close seen, warm-up bars included, in order
let entryRef: number | null = null; // the fill bar's open: what the exits are measured against
let peakClose: number | null = null; // the best close since the fill
let barsHeld = 0; // batches answered since the fill

await runBars({
  onBatch(state, batch) {
    // The bar this batch itself carried for the symbol, if any (a minute can have no bar).
    let fresh: Bar | null = null;
    for (const bar of batch.bars) if (bar.symbol === SYMBOL) fresh = bar;
    const close = fresh === null ? null : Number(fresh.c);
    if (close !== null) closes.push(close);

    const held = state.positions.get(SYMBOL);

    // The batch after a buy decision reports the fill as a position: adopt its bar's open as
    // the reference the take-profit and the trailing stop are measured from. If that batch
    // carries no bar for the symbol (a minute with no sample), fall back to the position's own
    // average cost, converted into the bars' price scale, so the exits are never left disarmed.
    if (held !== undefined && entryRef === null) {
      if (fresh !== null) {
        entryRef = Number(fresh.o);
        peakClose = close;
        barsHeld = 0;
      } else {
        const meta = state.symbols.get(SYMBOL);
        if (meta !== undefined && held.qty > 0n) {
          const scale = 10n ** BigInt(meta.qty_scale + meta.price_scale - state.hello.capital.quote_scale);
          entryRef = Number((held.cost * scale) / held.qty);
          peakClose = state.close(SYMBOL) === null ? entryRef : Number(state.close(SYMBOL));
          barsHeld = 0;
        }
      }
    }

    if (held === undefined) {
      entryRef = null;
      peakClose = null;
      barsHeld = 0;
      if (state.warmingUp || close === null) return [];
      const scoredIndex = state.seq - state.warmupBars;
      if (scoredIndex >= WINDOW_BARS - LATE_ENTRY_CUTOFF) return [];
      if (closes.length > FLUSH_WINDOW && closes.length > RECOVERY_WINDOW) {
        const flushed = closes[closes.length - 1] / closes[closes.length - 1 - FLUSH_WINDOW] - 1 <= -FLUSH_DROP;
        const turned = closes[closes.length - 1] / closes[closes.length - 1 - RECOVERY_WINDOW] - 1 >= RECOVERY_RISE;
        if (flushed && turned && state.cash > 0n) {
          const order: BuyInput = {
            side: 'buy',
            symbol: SYMBOL,
            notional_quote_units: state.cash,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          };
          return [order];
        }
      }
      return [];
    }

    // Holding: manage the exit.
    if (close === null || entryRef === null || peakClose === null) return [];
    barsHeld += 1;
    if (close > peakClose) peakClose = close;
    const gain = close / entryRef - 1;
    const trailed = close <= peakClose * (1 - TRAILING_STOP);
    if (gain >= TAKE_PROFIT || trailed || barsHeld >= MAX_HOLD) {
      const order: SellInput = {
        side: 'sell',
        symbol: SYMBOL,
        qty: held.qty,
        max_slippage_bps: MAX_SLIPPAGE_BPS,
      };
      return [order];
    }
    return [];
  },
});

# BTC Race Bot — capitulation reversal

A long-only cbBTC/USDC bot for make.fun's 24-hour BTC trading-bot race. It sits in cash until a
capitulation flush (a fall of at least 2.5% over two hours) has demonstrably turned (the last
fifteen minutes up at least 0.3%), then buys with the whole account and exits on a +2.0%
take-profit, a 1.0% trailing stop, or after four hours.

Run it the way the harness does:

    node main.ts           # speaks agent-fun/bars-replay/v1 on stdin/stdout

Built by an AI agent for make.fun's "Race a BTC trading bot live for 24 hours" bounty.
[The bounty](https://make.fun/bounty/btc-race-24h-20261115-0828)

const derivClient = require("../api/deriv-client");
const config = require("../config/config");
const signals = require("./signals");
const executor = require("../execution/executor");
// const executor = require('../execution/executor'); // To be implemented

class StrategyEngine {
  constructor() {
    this.activeSymbols = Object.values(config.symbols);
    this.state = {}; // Store state per symbol
    // State structure:
    // {
    //   [symbol]: {
    //     candles5m: [],
    //     candles1h: [],
    //     swings: [],
    //     structure: 'bullish'/'bearish',
    //     pendingOrderBlock: null
    //   }
    // }
  }

  async start() {
    console.log("Starting Strategy Engine...");
    try {
      await derivClient.connect();

      for (const symbol of this.activeSymbols) {
        try {
          console.log(`Initializing ${symbol}...`);
          this.state[symbol] = {
            candles5m: [],
            candles1h: [],
            swings: [],
            structure: null,
            pendingSetup: null,
            trend1h: null,
          };

          // 1. Fetch History
          await this.initializeHistory(symbol);

          // 2. Initial Analysis
          await this.analyze1HStructure(symbol);
          console.log(
            `[${symbol}] Initial 1H Trend: ${
              this.state[symbol].trend1h || "N/A"
            }`
          );

          // 3. Subscribe to 5m Candles
          console.log(`Subscribing to 5m candles for ${symbol}`);
          await derivClient.subscribeCandles(
            symbol,
            config.strategy.timeframes.execution,
            (candle) => this.onCandleUpdate(symbol, candle)
          );
        } catch (error) {
          if (error.code === "MarketIsClosed") {
            console.warn(`[WARN] Market is closed for ${symbol}. Skipping...`);
          } else {
            console.error(`[ERROR] Failed to initialize ${symbol}:`, error);
          }
        }
      }

      this.startHeartbeat();
    } catch (error) {
      console.error("Error starting engine:", error);
    }
  }

  startHeartbeat() {
    setInterval(() => {
      const symbols = Object.keys(this.state).join(", ");
      console.log(
        `[HEARTBEAT] Bot is active and monitoring: ${symbols} at ${new Date().toLocaleTimeString()}`
      );
    }, 60000); // Every minute
  }

  async initializeHistory(symbol) {
    // Fetch 5m candles
    const m5 = await derivClient.getCandles(
      symbol,
      config.strategy.timeframes.execution,
      100
    );
    this.state[symbol].candles5m = m5.candles;

    // Initial Analysis
    this.analyzeStructure(symbol);
  }

  async analyze1HStructure(symbol) {
    try {
      const h1 = await derivClient.getCandles(
        symbol,
        config.strategy.timeframes.analysis, // 3600
        24
      );
      this.state[symbol].candles1h = h1.candles;

      const candles = h1.candles;
      if (candles.length < 10) return;

      const last = candles[candles.length - 1];
      const prev = candles[candles.length - 10];

      if (last.close > prev.close) this.state[symbol].trend1h = "bullish";
      else if (last.close < prev.close) this.state[symbol].trend1h = "bearish";
      else this.state[symbol].trend1h = "ranging";
    } catch (error) {
      console.error(`[${symbol}] Error analyzing 1H structure:`, error);
    }
  }

  analyzeStructure(symbol) {
    const candles = this.state[symbol].candles5m;
    // Simple Swing Point detection
    // We update swings
    this.state[symbol].swings = signals.findSwingPoints(candles);
  }

  async onCandleUpdate(symbol, candle) {
    const state = this.state[symbol];

    // Normalize candle time: historical candles use 'epoch', stream uses 'open_time'
    const candleOpenTime = candle.open_time || candle.epoch;
    const lastSaved = state.candles5m[state.candles5m.length - 1];
    const lastOpenTime = lastSaved ? lastSaved.open_time || lastSaved.epoch : 0;

    // Check if it's an update to the current candle
    if (lastSaved && candleOpenTime === lastOpenTime) {
      state.candles5m[state.candles5m.length - 1] = candle;
    }
    // It's a brand new candle
    else if (candleOpenTime > lastOpenTime) {
      if (lastSaved) {
        // The previous candle is now officially closed
        this.onCandleClose(symbol, lastSaved);
      }
      state.candles5m.push(candle);
      if (state.candles5m.length > 200) state.candles5m.shift();

      // Update 1H trend every hour (approx)
      if (state.candles5m.length % 12 === 0) {
        this.analyze1HStructure(symbol);
      }
    }
  }

  async onCandleClose(symbol, closedCandle) {
    const timeStr = new Date(closedCandle.epoch * 1000).toLocaleString();
    console.log(
      `[${symbol}] 5M Candle Closed: ${closedCandle.epoch} (${timeStr})`
    );
    const state = this.state[symbol];

    this.analyzeStructure(symbol);
    const swings = state.swings;

    if (swings.length > 0) {
      const lastHigh = swings.filter((s) => s.type === "high").pop();
      const lastLow = swings.filter((s) => s.type === "low").pop();
      console.log(
        `[${symbol}] Monitoring - High: ${lastHigh?.price || "N/A"}, Low: ${
          lastLow?.price || "N/A"
        }`
      );
    }

    // 0. Check 1H Trend (HTF Context)
    const trend1h = state.trend1h;
    console.log(`[${symbol}] Current 1H Context: ${trend1h || "Unknown"}`);

    // If we have an active setup we're watching, check for the next step
    if (state.pendingSetup) {
      console.log(`[${symbol}] WATCHING: ${state.pendingSetup.stage} setup...`);
      this.processPendingSetup(symbol, closedCandle, trend1h);
      return;
    }

    // 1. Check for Liquidity Sweep (Only if trend aligns)
    if (swings.length > 0) {
      const lastHigh = swings.filter((s) => s.type === "high").pop();
      const lastLow = swings.filter((s) => s.type === "low").pop();

      const sweepHigh = lastHigh
        ? signals.checkLiquiditySweep(state.candles5m, lastHigh)
        : null;
      const sweepLow = lastLow
        ? signals.checkLiquiditySweep(state.candles5m, lastLow)
        : null;

      let sweep = null;
      if (sweepHigh && trend1h === "bearish") sweep = sweepHigh;
      if (sweepLow && trend1h === "bullish") sweep = sweepLow;

      if (sweep) {
        console.log(
          `[${symbol}] >>> SWEEP DETECTED! <<< Type: ${sweep.type} (Aligned with 1H ${trend1h} trend)`
        );
        state.pendingSetup = {
          stage: "SWEPT",
          type: sweep.type,
          sweepCandle: sweep.candle,
          timestamp: Date.now(),
        };
      } else if (sweepHigh || sweepLow) {
        console.log(
          `[${symbol}] Sweep detected but ignored (Counter-trend to 1H ${trend1h})`
        );
      }
    }
  }

  // getTrend(symbol) removed in favor of HTF analysis

  async processPendingSetup(symbol, closedCandle, trend) {
    const state = this.state[symbol];
    const setup = state.pendingSetup;

    // Timeout setups after 20 candles
    if (Date.now() - setup.timestamp > 20 * 300 * 1000) {
      console.log(`[${symbol}] Setup timed out.`);
      state.pendingSetup = null;
      return;
    }

    if (setup.stage === "SWEPT") {
      console.log(`[${symbol}] Stage: SWEPT. Searching for BoS...`);
      // Look for BoS/CHoCH in opposite direction
      const targetType = setup.type === "bearish_sweep" ? "low" : "high";
      const recentSwings = signals.findSwingPoints(
        state.candles5m.slice(-10),
        2
      );
      const relevantSwing = recentSwings.find((s) => s.type === targetType);

      if (relevantSwing) {
        const bos = signals.checkStructureBreak(state.candles5m, relevantSwing);
        if (bos) {
          console.log(
            `[${symbol}] ✅ BoS Detected! Moving to STRUCTURE_BROKEN stage.`
          );
          setup.stage = "STRUCTURE_BROKEN";
          setup.bosCandle = closedCandle;

          // Find OB and FVG
          console.log(`[${symbol}] Searching for FVG and OB...`);
          const obDirection =
            setup.type === "bearish_sweep" ? "bearish" : "bullish";
          setup.ob = signals.findOrderBlock(state.candles5m, obDirection);
          setup.fvg = signals.findFVG(state.candles5m);

          if (setup.ob && setup.fvg) {
            console.log(
              `[${symbol}] ✅ FVG Found at ${setup.fvg.top}-${setup.fvg.bottom}`
            );
            console.log(
              `[${symbol}] ✅ OB Found at ${setup.ob.candle.open}-${setup.ob.candle.close}`
            );
            console.log(
              `[${symbol}] Setup Complete! Waiting for price to TAP the Order Block.`
            );
          } else {
            if (!setup.ob)
              console.log(`[${symbol}] ❌ No suitable Order Block found.`);
            if (!setup.fvg)
              console.log(`[${symbol}] ❌ No Fair Value Gap (FVG) found.`);
            console.log(`[${symbol}] Setup invalidated.`);
            state.pendingSetup = null;
          }
        }
      }
    } else if (setup.stage === "STRUCTURE_BROKEN") {
      const obHigh = Math.max(setup.ob.candle.open, setup.ob.candle.close);
      const obLow = Math.min(setup.ob.candle.open, setup.ob.candle.close);
      console.log(
        `[${symbol}] Waiting for price to enter OB Range (${obLow.toFixed(
          5
        )} - ${obHigh.toFixed(5)}). Current Close: ${closedCandle.close.toFixed(
          5
        )}`
      );

      // Wait for tap into OB
      if (signals.checkOBTap(closedCandle, setup.ob)) {
        console.log(`[${symbol}] 🎯 OB Tapped! EXECUTING TRADE`);
        const tradeType = setup.type === "bearish_sweep" ? "sell" : "buy";

        // 10 Pips Fixed Stop Loss Calculation
        let pipValue = 0.0001; // Default for 5 decimal pairs (GBPUSD)
        if (symbol.includes("JPY")) pipValue = 0.01;
        if (symbol.includes("XAU")) pipValue = 0.1;

        const tenPips = pipValue * 10;
        const stopLoss =
          tradeType === "buy"
            ? closedCandle.close - tenPips
            : closedCandle.close + tenPips;

        console.log(
          `[${symbol}] Sending ${tradeType.toUpperCase()} order to Executor...`
        );
        await executor.executeTrade(symbol, tradeType, stopLoss);
        state.pendingSetup = null;
      }
    }
  }
}

module.exports = new StrategyEngine();

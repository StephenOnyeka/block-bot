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
            pendingOrderBlock: null,
          };

          // 1. Fetch History
          await this.initializeHistory(symbol);

          // 2. Subscribe to 5m Candles
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
    } catch (error) {
      console.error("Error starting engine:", error);
    }
  }

  async initializeHistory(symbol) {
    // Fetch 1h candles
    const h1 = await derivClient.getCandles(
      symbol,
      config.strategy.timeframes.analysis,
      100
    );
    this.state[symbol].candles1h = h1.candles;

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

  analyzeStructure(symbol) {
    const candles = this.state[symbol].candles5m;
    // Simple Swing Point detection
    // We update swings
    this.state[symbol].swings = signals.findSwingPoints(candles);
  }

  async onCandleUpdate(symbol, candle) {
    const state = this.state[symbol];
    const lastSaved = state.candles5m[state.candles5m.length - 1];

    // Check if it's a new candle or update
    if (lastSaved && candle.epoch === lastSaved.epoch) {
      // Update the last candle
      state.candles5m[state.candles5m.length - 1] = candle;
    } else {
      // New candle closed (implied), push new one
      // Note: Deriv stream sends the *current* forming candle.
      // When epoch changes, the previous one is closed.
      if (lastSaved && candle.epoch > lastSaved.epoch) {
        this.onCandleClose(symbol, lastSaved);
        state.candles5m.push(candle);
        // Keep array size manageable
        if (state.candles5m.length > 200) state.candles5m.shift();
      } else if (!lastSaved) {
        state.candles5m.push(candle);
      }
    }
  }

  async onCandleClose(symbol, closedCandle) {
    console.log(`[${symbol}] 5M Candle Closed: ${closedCandle.epoch}`);
    const state = this.state[symbol];

    this.analyzeStructure(symbol);
    const swings = state.swings;

    // 0. Check 1H Structure (Context)
    // For simplicity, we check if 1H is trending (higher highs or lower lows)
    const h1Structure = this.get1HStructure(symbol);
    console.log(`[${symbol}] 1H Structure: ${h1Structure || "Ranging"}`);

    // If we have an active setup we're watching, check for the next step
    if (state.pendingSetup) {
      this.processPendingSetup(symbol, closedCandle, h1Structure);
      return;
    }

    // 1. Check for Liquidity Sweep
    if (swings.length > 0) {
      const lastSwing = swings[swings.length - 1];
      const sweep = signals.checkLiquiditySweep(state.candles5m, lastSwing);

      if (sweep) {
        console.log(`[${symbol}] Sweep detected! Type: ${sweep.type}`);
        // Only take sweeps that align with 1H structure OR are potentially reversal CHoCH
        state.pendingSetup = {
          stage: "SWEPT",
          type: sweep.type, // bearish_sweep (took high) or bullish_sweep (took low)
          sweepCandle: sweep.candle,
          timestamp: Date.now(),
        };
      }
    }
  }

  get1HStructure(symbol) {
    const candles = this.state[symbol].candles1h;
    if (candles.length < 5) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 10]; // Compare over a gap
    if (last.close > prev.close) return "bullish";
    if (last.close < prev.close) return "bearish";
    return null;
  }

  async processPendingSetup(symbol, closedCandle, h1Structure) {
    const state = this.state[symbol];
    const setup = state.pendingSetup;

    // Timeout setups after 20 candles (5m * 20 = 100 mins)
    if (Date.now() - setup.timestamp > 20 * 300 * 1000) {
      console.log(`[${symbol}] Setup timed out.`);
      state.pendingSetup = null;
      return;
    }

    if (setup.stage === "SWEPT") {
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
            `[${symbol}] BoS detected after sweep! Stage: STRUCTURE_BROKEN`
          );
          setup.stage = "STRUCTURE_BROKEN";
          setup.bosCandle = closedCandle;

          // Find OB and FVG
          const obDirection =
            setup.type === "bearish_sweep" ? "bearish" : "bullish";
          setup.ob = signals.findOrderBlock(state.candles5m, obDirection);
          setup.fvg = signals.findFVG(state.candles5m);

          if (!setup.ob || !setup.fvg) {
            console.log(`[${symbol}] Missing OB or FVG. Setup invalidated.`);
            state.pendingSetup = null;
          }
        }
      }
    } else if (setup.stage === "STRUCTURE_BROKEN") {
      // Wait for tap into OB
      if (signals.checkOBTap(closedCandle, setup.ob)) {
        console.log(`[${symbol}] OB Tapped! EXECUTING TRADE`);
        const tradeType = setup.type === "bearish_sweep" ? "sell" : "buy";

        // 1:2 RR Calculation
        const slDist = Math.abs(closedCandle.close - setup.ob.candle.high); // crude SL
        const stopLoss =
          tradeType === "buy"
            ? closedCandle.close - slDist
            : closedCandle.close + slDist;

        await executor.executeTrade(symbol, tradeType, stopLoss);
        state.pendingSetup = null;
      }
    }
  }
}

module.exports = new StrategyEngine();

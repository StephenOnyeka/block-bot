/**
 * Signal detection logic for Order Block Strategy
 */

class SignalDetector {
  /**
   * Check for Liquidity Sweep
   * A sweep occurs when a candle wick (high/low) breaches a previous swing point
   * but the body closes within the range.
   *
   * @param {Array} candles - Array of recent candles
   * @param {Object} swingPoint - { price, type: 'high'|'low', index }
   * @returns {Object|null} - Sweep details or null
   */
  checkLiquiditySweep(candles, swingPoint) {
    const lastCandle = candles[candles.length - 1];

    if (swingPoint.type === "high") {
      if (
        lastCandle.high > swingPoint.price &&
        lastCandle.close < swingPoint.price
      ) {
        return { type: "bearish_sweep", candle: lastCandle, swing: swingPoint };
      }
    } else if (swingPoint.type === "low") {
      if (
        lastCandle.low < swingPoint.price &&
        lastCandle.close > swingPoint.price
      ) {
        return { type: "bullish_sweep", candle: lastCandle, swing: swingPoint };
      }
    }
    return null;
  }

  /**
   * Check for Break of Structure (BoS) or Change of Character (ChoCh)
   * Occurs when a candle body closes beyond a swing point.
   */
  checkStructureBreak(candles, swingPoint) {
    const lastCandle = candles[candles.length - 1];

    if (swingPoint.type === "high") {
      if (lastCandle.close > swingPoint.price) {
        return { type: "bullish_break", candle: lastCandle, swing: swingPoint };
      }
    } else if (swingPoint.type === "low") {
      if (lastCandle.close < swingPoint.price) {
        return { type: "bearish_break", candle: lastCandle, swing: swingPoint };
      }
    }
    return null;
  }

  /**
   * Identify Fair Value Gaps (FVG)
   * Looks at the last 3 completed candles.
   */
  findFVG(candles) {
    if (candles.length < 3) return null;

    const c1 = candles[candles.length - 3];
    const c2 = candles[candles.length - 2]; // The impulsive candle
    const c3 = candles[candles.length - 1];

    // Bullish FVG: C1 High < C3 Low
    if (c1.high < c3.low) {
      return {
        type: "bullish_fvg",
        top: c3.low,
        bottom: c1.high,
        candle: c2,
      };
    }

    // Bearish FVG: C1 Low > C3 High
    if (c1.low > c3.high) {
      return {
        type: "bearish_fvg",
        top: c1.low,
        bottom: c3.high,
        candle: c2,
      };
    }

    return null;
  }

  /**
   * Identify Order Block (OB)
   * The last opposite colored candle before the impulsive move that created the FVG/BoS.
   */
  findOrderBlock(candles, direction) {
    // Simple logic: Scan backwards from the impulse to find the last opposite candle
    // direction 'bullish' means we look for a red candle (down candle)
    // direction 'bearish' means we look for a green candle (up candle)

    for (let i = candles.length - 2; i >= 0; i--) {
      const candle = candles[i];
      const isGreen = candle.close > candle.open;

      if (direction === "bullish" && !isGreen) {
        return { type: "bullish_ob", candle: candle, index: i };
      }
      if (direction === "bearish" && isGreen) {
        return { type: "bearish_ob", candle: candle, index: i };
      }

      // Limit search depth
      if (candles.length - i > 10) break;
    }
    return null;
  }

  /**
   * Check if price has tapped into the Order Block
   * @param {Object} lastCandle
   * @param {Object} orderBlock
   * @returns {boolean}
   */
  checkOBTap(lastCandle, orderBlock) {
    const obHigh = Math.max(orderBlock.candle.open, orderBlock.candle.close);
    const obLow = Math.min(orderBlock.candle.open, orderBlock.candle.close);

    if (orderBlock.type === "bullish_ob") {
      // Price needs to dip into the OB high-low range
      return lastCandle.low <= obHigh && lastCandle.low >= obLow;
    } else {
      // Bearish OB: price needs to rally into the OB range
      return lastCandle.high >= obLow && lastCandle.high <= obHigh;
    }
  }

  /**
   * Helper to find recent swing points (ZigZag like)
   * Simple implementation: highest/lowest of N neighbors
   */
  findSwingPoints(candles, period = 3) {
    const swings = [];
    for (let i = period; i < candles.length - period; i++) {
      const currentHigh = candles[i].high;
      const currentLow = candles[i].low;

      let isHigh = true;
      let isLow = true;

      for (let j = 1; j <= period; j++) {
        if (
          candles[i - j].high >= currentHigh ||
          candles[i + j].high >= currentHigh
        )
          isHigh = false;
        if (
          candles[i - j].low <= currentLow ||
          candles[i + j].low <= currentLow
        )
          isLow = false;
      }

      if (isHigh)
        swings.push({
          type: "high",
          price: currentHigh,
          index: i,
          time: candles[i].epoch,
        });
      if (isLow)
        swings.push({
          type: "low",
          price: currentLow,
          index: i,
          time: candles[i].epoch,
        });
    }
    return swings;
  }
}

module.exports = new SignalDetector();

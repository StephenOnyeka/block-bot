const derivClient = require("../api/deriv-client");
const config = require("../config/config");

class Executor {
  constructor() {
    this.openPositions = [];
  }

  /**
   * Execute a trade based on a signal
   * @param {string} symbol
   * @param {string} type 'buy' or 'sell'
   * @param {number} stopLossPrice
   */
  async executeTrade(symbol, type, stopLossPrice) {
    console.log(`[EXECUTOR] Executing ${type.toUpperCase()} on ${symbol}`);

    try {
      const amount = this.calculatePositionSize();
      const contractType = type === "buy" ? "MULTUP" : "MULTDOWN";

      // Fetch current price for TP calculation
      const ticks = await derivClient.send({ ticks: symbol, count: 1 });
      const currentPrice = ticks.tick.quote;

      const slDistance = Math.abs(currentPrice - stopLossPrice);
      const tpDistance = slDistance * 2; // 1:2 RR
      const takeProfitPrice =
        type === "buy" ? currentPrice + tpDistance : currentPrice - tpDistance;

      console.log(
        `[EXECUTOR] Entry: ${currentPrice}, SL: ${stopLossPrice}, TP: ${takeProfitPrice}`
      );

      const proposal = await derivClient.send({
        proposal: 1,
        amount: amount,
        basis: "stake",
        contract_type: contractType,
        currency: "USD",
        symbol: symbol,
        limit_order: {
          stop_loss: slDistance, // Multipliers often use distance
          take_profit: tpDistance,
        },
        multiplier: 10, // Example multiplier
      });

      if (proposal.proposal && proposal.proposal.id) {
        const order = await derivClient.send({
          buy: proposal.proposal.id,
          price: proposal.proposal.ask_price,
        });
        console.log(`[EXECUTOR] Order Placed: ID ${order.buy.contract_id}`);

        this.openPositions.push({
          id: order.buy.contract_id,
          symbol,
          type,
          entryPrice: currentPrice,
          stopLoss: stopLossPrice,
          takeProfit: takeProfitPrice,
          entryTime: Date.now(),
        });

        return order;
      }
    } catch (error) {
      console.error("[EXECUTOR] Trade Execution Failed:", error);
    }
  }

  calculatePositionSize() {
    // Use fixed stake for now
    // config.strategy.riskPerTrade could be used to calculate stake based on account balance
    return 10; // $10 Stake default
  }
}

module.exports = new Executor();

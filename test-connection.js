const derivClient = require("./src/api/deriv-client");
const config = require("./src/config/config");

async function testConnection() {
  try {
    console.log("Testing Deriv API Connection...");
    await derivClient.connect();
    console.log("Connection Successful!");

    const symbol = config.symbols["GBP/USD"];
    console.log(`Fetching candles for ${symbol}...`);

    // Fetch 5M candles
    const candles = await derivClient.getCandles(
      symbol,
      config.strategy.timeframes.execution,
      10
    );
    console.log(`Retrieved ${candles.candles.length} candles.`);
    console.log("Latest candle:", candles.candles[candles.candles.length - 1]);

    console.log("Subscribing to ticks...");
    await derivClient.subscribeTicks(symbol, (tick) => {
      console.log("Tick received:", tick.quote);
      // Close after one tick for test
      process.exit(0);
    });
  } catch (error) {
    console.error("Test Failed:", error);
    process.exit(1);
  }
}

testConnection();

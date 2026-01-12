// require("dotenv").config(); // Handled in deriv-client.js

const config = {
  deriv: {
    token: process.env.DERIV_API_TOKEN,
    appId: process.env.APP_ID || 1089,
    wsUrl: process.env.DERIV_WS_URL,
  },
  // Map user friendly names to Deriv symbols
  symbols: {
    "GBP/USD": "frxGBPUSD",
    "USD/JPY": "frxUSDJPY",
    "XAU/USD": "frxXAUUSD", // Gold often has different codes like 'gold' or 'frxXAUUSD' depending on account type. Using standard forex for now.
  },
  strategy: {
    timeframes: {
      analysis: 3600, // 1 Hour in seconds
      execution: 300, // 5 Minutes in seconds
    },
    riskReward: 1.2, // 1:2
    riskPerTrade: 0.01, // 1%
  },
};

module.exports = config;

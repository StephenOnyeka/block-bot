Here is the breakdown of how your specific requirements are met in the project:

1. Strategy Components (SMC)

- Swept Liquidity: Handled in **signals.js**
  via
  **checkLiquiditySweep()**
  . It detects when a candle wick breaches a recent swing high/low and closes back inside.
- BoS / Change of Character: Handled in **signals.js**
  via
  **checkStructureBreak()**
  . The bot looks for a candle body closing beyond a swing point after a sweep has occurred.
- Fair Value Gap (FVG): Handled in **signals.js**
  via
  **findFVG()**
  . It identifies gaps between the high of Candle 1 and the low of Candle 3 (and vice versa).
- Order Block (OB) Tapping: Handled in **signals.js**
  via
  **checkOBTap()**
  . This is your "internal liquidity" requirement—the bot waits for the price to return and "dip" into the OB range before firing the trade.

2. Timeframes & Analysis
   5-Minute Execution: The bot is subscribed to the 300 second (5m) candle stream for all entry and pattern detection.
   1-Hour Analysis: The bot fetches 1H history in
   **engine.js**
   and runs
   **get1HStructure()**
   to ensure the trade aligns with the higher-timeframe trend (e.g., only buying in a 1H bullish market).
3. Pairs & Risk Management
   Three Pairs:
   **config.js**    
   is strictly limited to GBP_USD, USD_JPY, and XAU_USD (mapped to Deriv's frx symbols).
   1:2 Risk Reward: Handled in
   **executor.js**
   inside
   **executeTrade()**
   . It takes the distance to the Order Block as the Stop Loss and automatically sets the Take Profit at exactly double that distance.
Conclusion: The technical "blueprint" of your strategy is fully built into the code. The bot is now "hunting" for the exact sequence you described!

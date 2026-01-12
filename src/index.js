const engine = require("./strategy/engine");
require("dotenv").config();

console.log("Starting Deriv Order Block Bot...");
console.log("Press Ctrl+C to stop");

engine.start().catch((err) => {
  console.error("Fatal Error:", err);
  process.exit(1);
});

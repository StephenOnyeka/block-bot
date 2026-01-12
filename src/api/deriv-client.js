const WebSocket = require("ws");
const dotenv = require("dotenv");

dotenv.config();

class DerivClient {
  constructor() {
    // this.appId = process.env.APP_ID || 1089;
    this.appId = process.env.APP_ID || 120631;
    this.token = process.env.DERIV_API_TOKEN;
    this.wsUrl =
      process.env.DERIV_WS_URL ||
      `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;
    this.ws = null;
    this.pingInterval = null;
    this.reqId = 0;
    this.pendingRequests = new Map();
    this.subscriptions = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", async () => {
        console.log("Connected to Deriv WebSocket");
        this.startPing();
        try {
          await this.authorize();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.ws.on("message", (data) => {
        const message = JSON.parse(data);
        this.handleMessage(message);
      });

      this.ws.on("error", (error) => {
        console.error("WebSocket Error:", error);
        reject(error);
      });

      this.ws.on("close", () => {
        console.log("WebSocket Connection Closed");
        this.stopPing();
      });
    });
  }

  startPing() {
    this.pingInterval = setInterval(() => {
      this.send({ ping: 1 });
    }, 30000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
  }

  send(request) {
    return new Promise((resolve, reject) => {
      this.reqId++;
      const reqId = this.reqId;
      request.req_id = reqId;
      const msgType = request.msg_type || Object.keys(request)[0];
      console.log(`[WS] Sending: ${msgType} (ID: ${reqId})`);

      this.pendingRequests.set(reqId, { resolve, reject });

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(request));
      } else {
        reject(new Error("WebSocket is not open"));
      }
    });
  }

  handleMessage(message) {
    const reqId = message.req_id;
    const msgType = message.msg_type;

    // Log non-data messages for debugging
    if (msgType !== "tick" && msgType !== "ohlc" && msgType !== "ping") {
      console.log(`[WS] Received: ${msgType} (ID: ${reqId || "N/A"})`);
    }

    if (msgType === "tick") {
      this.handleTick(message);
    } else if (msgType === "ohlc") {
      this.handleOhlc(message);
    }

    if (reqId && this.pendingRequests.has(reqId)) {
      const { resolve, reject } = this.pendingRequests.get(reqId);

      if (message.error) {
        reject(message.error);
      } else {
        resolve(message);
      }

      this.pendingRequests.delete(reqId);
    }
  }

  async authorize() {
    if (!this.token) {
      throw new Error("API Token is missing");
    }
    console.log("Authorizing...");
    const response = await this.send({ authorize: this.token });
    console.log("Authorized for account:", response.authorize.loginid);
    return response;
  }

  async getCandles(symbol, granularity, count = 100) {
    const request = {
      ticks_history: symbol,
      adjust_start_time: 1,
      count: count,
      end: "latest",
      style: "candles",
      granularity: granularity,
    };
    return this.send(request);
  }

  async subscribeTicks(symbol, callback) {
    this.subscriptions.set(symbol, callback);
    return this.send({
      ticks: symbol,
      subscribe: 1,
    });
  }

  handleTick(message) {
    const symbol = message.tick.symbol;
    if (this.subscriptions.has(symbol)) {
      const callback = this.subscriptions.get(symbol);
      callback(message.tick);
    }
  }

  async subscribeCandles(symbol, granularity, callback) {
    const streamKey = `candle_${symbol}_${granularity}`;
    this.subscriptions.set(streamKey, callback);

    return this.send({
      ticks_history: symbol,
      adjust_start_time: 1,
      count: 1,
      end: "latest",
      style: "candles",
      granularity: granularity,
      subscribe: 1,
    });
  }

  handleOhlc(message) {
    const ohlc = message.ohlc;
    const symbol = ohlc.symbol;
    const granularity = ohlc.granularity;
    const streamKey = `candle_${symbol}_${granularity}`;

    if (this.subscriptions.has(streamKey)) {
      const callback = this.subscriptions.get(streamKey);
      callback(ohlc);
    }
  }

  async placeOrder(symbol, contractType, amount, barrier = null) {
    // This is a generic order placement using proposal + buy
    // For Multipliers, specify correct contract_type
    const proposal = await this.send({
      proposal: 1,
      amount: amount,
      basis: "stake",
      contract_type: contractType,
      currency: "USD",
      symbol: symbol,
      duration: 5,
      duration_unit: "m",
    });

    if (proposal.proposal && proposal.proposal.id) {
      return this.send({
        buy: proposal.proposal.id,
        price: proposal.proposal.ask_price,
      });
    }
    throw new Error("Failed to get proposal for order");
  }
}

module.exports = new DerivClient();

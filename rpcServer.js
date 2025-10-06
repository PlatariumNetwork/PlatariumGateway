// rpcServer.js
import express from "express";
import bodyParser from "body-parser";
import { Blockchain } from 'platarium-network';

import { balanceRoute } from "./routes/balance.js";
import { transactionRoute } from "./routes/transaction.js";
import { transactionsRoute } from "./routes/transactions.js";
import { sendTransactionRoute } from "./routes/sendTransaction.js";

import { createSocketServer } from "./server/modules/socketServer.js";

const PORT_REST = 1812;
const PORT_WS = 1813;

async function startServer() {
  console.log("[Logging activated]");
  console.log("Creating blockchain...");

  const blockchain = new Blockchain();
  await blockchain.init();
  console.log("Blockchain initialized for REST API");

  // --- REST API ---
  const app = express();
  app.use(bodyParser.json());

  balanceRoute(app, blockchain);
  transactionRoute(app, blockchain);
  transactionsRoute(app, blockchain);
  sendTransactionRoute(app, blockchain);

  app.get("/", (req, res) => {
    res.json({ message: "PlatariumGateway v1.0.0 is running with platarium-network" });
  });

  app.listen(PORT_REST, () => {
    console.log(`REST API running at http://localhost:${PORT_REST}`);
  });

  // --- Socket.io ---
  await createSocketServer(PORT_WS);
}

startServer().catch(err => {
  console.error("Error starting server:", err);
});

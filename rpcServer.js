// rpcServer.js
import express from "express";
import bodyParser from "body-parser";
import { Blockchain } from 'platarium-network';
import os from 'os';

import { balanceRoute } from "./routes/balance.js";
import { transactionRoute } from "./routes/transaction.js";
import { transactionsRoute } from "./routes/transactions.js";
import { sendTransactionRoute } from "./routes/sendTransaction.js";

import { createSocketServer } from "./server/modules/socketServer.js";
import { NodesManager } from "./server/modules/nodesManager.js";

// ---- Read CLI arguments ----
const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

// Use CLI args or defaults
const PORT_REST = parseInt(getArg("--port", 1812));
const PORT_WS = parseInt(getArg("--ws", 1813));

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

async function startServer() {
  console.log("[Logging activated]");
  console.log(`Starting Platarium Gateway on REST:${PORT_REST}, WS:${PORT_WS}`);

  // --- Blockchain ---
  const blockchain = new Blockchain();
  await blockchain.init();
  console.log("Blockchain initialized for REST API");

  const nodeHost = "rpc-melancholy-testnet.platarium.network";
  const nodesManager = new NodesManager(PORT_WS, nodeHost);

  // --- Express app ---
  const app = express();
  app.use(bodyParser.json());

  // Optional CORS headers
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // --- Routes ---
  balanceRoute(app, blockchain);
  transactionRoute(app, blockchain);
  transactionsRoute(app, blockchain);
  sendTransactionRoute(app, blockchain, nodesManager);

  // Root route
  app.get("/", (req, res) => {
    res.json({
      message: "PlatariumGateway v1.0.0 is running with platarium-network",
      nodeId: nodesManager.getNodeId(),
      nodeAddress: nodesManager.getNodeAddress(),
      connectedPeers: nodesManager.getConnectedNodes().length
    });
  });

  // Network info
  app.get("/network", (req, res) => {
    res.json({
      nodeId: nodesManager.getNodeId(),
      nodeAddress: nodesManager.getNodeAddress(),
      connectedNodes: nodesManager.getConnectedNodes()
    });
  });

  // Status endpoint
  app.get("/status", (req, res) => {
    res.status(200).json({ 
      status: "ok", 
      timestamp: Date.now(),
      network: "Melancholy Testnet"
    });
  });

  // --- WebSocket ---
  const { broadcastEvent, getConnectedSockets } = await createSocketServer(PORT_WS, blockchain, nodesManager);
  global.broadcastEvent = broadcastEvent;
  global.nodesManager = nodesManager;
  global.getConnectedSockets = getConnectedSockets;

  // Sockets overview
  app.get("/sockets", async (req, res) => {
    await nodesManager.queryPeerSockets();
    res.json({
      nodeId: nodesManager.getNodeId(),
      nodeAddress: nodesManager.getNodeAddress(),
      connectedSockets: nodesManager.getConnectedSockets(),
      summary: {
        connectedClients: nodesManager.getConnectedSockets().length,
        connectedPeers: nodesManager.getConnectedNodes().length
      }
    });
  });

  // --- Start server ---
  app.listen(PORT_REST, () => {
    console.log(`REST API running at http://localhost:${PORT_REST}`);
  });

  // Connect to peers after small delay
  setTimeout(async () => {
    console.log("[NODE] Connecting to peer nodes...");
    await nodesManager.connectToPeers();
  }, 1000);
}

// Start the server
startServer().catch(err => {
  console.error("Error starting server:", err);
});

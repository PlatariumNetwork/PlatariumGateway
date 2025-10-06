# PlatariumGateway

Gateway for blockchain integration via REST and WebSocket in the Platarium network.  
It provides transaction processing, balance management, and blockchain interaction through both REST API and Socket.io.

---

## Features

- REST API for querying balances, transactions, and sending new transactions
- WebSocket (Socket.io) server for real-time transaction broadcasting
- Transaction signing and validation using the `platarium-network` package
- Modular structure for easy extension

---

## Requirements

- Node.js v18+
- npm or yarn
- `platarium-network` package

---

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/PlatariumNetwork/PlatariumGateway.git
cd PlatariumGateway
npm install
```

## Usage
Start the gateway:
```bash
node rpcServer.js
```
This will run:
* REST API at http://localhost:1812
* WebSocket server at ws://localhost:1813

REST API Endpoints
* GET / – Health check (server info)
* GET /balance/:address – Get balance of an address
* GET /transaction/:hash – Get transaction by hash
* GET /transactions/:address – Get all transactions for an address
* POST /sendTransaction – Send a new signed transaction

## Logging
The gateway logs important events to the console:
* Blockchain initialization
* Incoming transactions
* Transaction validation and errors
* REST and WebSocket activity
## License
MIT License © Platarium Network
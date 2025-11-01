# PlatariumGateway

Gateway for blockchain integration via REST and WebSocket in the Platarium network.  
It provides transaction processing, balance management, and blockchain interaction through both REST API and Socket.io.

**Fully Peer-to-Peer Architecture**: All nodes run at equal level with no master/slave hierarchy. Each node can connect to any other node and automatically synchronizes blockchain events and client connections.

---

## Features

- **P2P Network Synchronization** - Multiple gateway nodes automatically connect and work as a synchronized network
- REST API for querying balances, transactions, and sending new transactions
- WebSocket (Socket.io) server for real-time transaction broadcasting
- **Dynamic node discovery** - Nodes automatically discover and connect to peer nodes
- **Real-time event broadcasting** - Blockchain events are synchronized across all connected nodes
- **Global socket registry** - Track all connected clients across all nodes
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

---

## Network Overview

### Architecture

PlatariumGateway uses a **peer-to-peer (P2P) architecture** where:

- **All nodes are equal peers** - No master/slave hierarchy
- Each node runs a **WebSocket server** for local clients
- Each node runs **Socket.IO clients** to connect to peer nodes
- Nodes automatically discover and connect to each other
- All blockchain events propagate across the entire network
- Client connections are tracked and shared across all nodes

### Components

1. **Node**: A single gateway instance running on a specific host/port
   - Each node has a unique UUID (nodeId)
   - Runs REST API and WebSocket server
   - Connects to peer nodes as a Socket.IO client

2. **Peer Nodes**: Other gateway instances in the network
   - Nodes connect to peers via WebSocket
   - Peers share blockchain events and client information
   - Automatic reconnection on disconnection

3. **Client Sockets**: WebSocket clients connected to any node
   - Local clients connect directly to a node's WebSocket server
   - Client connections are announced to all peer nodes
   - All clients receive real-time blockchain events

### Event Flow

The P2P network uses several event types for synchronization:

#### `node:announce`
- **Trigger**: When a node connects to a peer
- **Purpose**: Announces the node's presence and identity
- **Data**: `{ nodeId, address, host, port }`
- **Flow**: Node A connects to Node B → Node A emits `node:announce` → Node B registers Node A as peer

#### `client:connected`
- **Trigger**: When a WebSocket client connects to any node
- **Purpose**: Notifies all peer nodes about new client connection
- **Data**: `{ nodeId, clientId, ip, connectedAt }`
- **Flow**: Client connects to Node A → Node A emits `client:connected` → All peers update their registries

#### `client:disconnected`
- **Trigger**: When a WebSocket client disconnects from any node
- **Purpose**: Notifies all peer nodes about client disconnection
- **Data**: `{ nodeId, clientId }`
- **Flow**: Client disconnects from Node A → Node A emits `client:disconnected` → All peers remove from registries

#### `blockchain:event`
- **Trigger**: When a blockchain event occurs (transaction, balance update, etc.)
- **Purpose**: Synchronize blockchain state across all nodes
- **Data**: `{ type, data, timestamp, originNodeId }`
- **Flow**: Event on Node A → Node A broadcasts `blockchain:event` → Peer nodes receive and rebroadcast (excluding origin) → All clients receive event

#### `sockets:request` / `sockets:response`
- **Trigger**: When a node needs to query peer socket lists
- **Purpose**: Synchronize socket registries across nodes
- **Data**: `{ nodeId, sockets[] }`
- **Flow**: Node A queries Node B → Node B responds with its socket list → Node A updates registry

### Loop Prevention

- Each `blockchain:event` includes an `originNodeId`
- Nodes ignore events they originated (prevents infinite loops)
- Events are only rebroadcast to peers, not back to origin
- Origin tracking ensures events propagate once per node

---

## Usage

### Starting a Single Node

```bash
node rpcServer.js
```

This will run:
- REST API at `http://localhost:1812`
- WebSocket server at `ws://localhost:1813`

### Starting Multiple Nodes

You can run multiple nodes on different ports:

**Terminal 1 (Node 1):**
```bash
node rpcServer.js --port 1812 --ws 1813
```

**Terminal 2 (Node 2):**
```bash
node rpcServer.js --port 1822 --ws 1823
```

**Terminal 3 (Node 3):**
```bash
node rpcServer.js --port 1832 --ws 1833
```

### Configuring Peer Connections

#### Method 1: Using `peers.json`

Create or edit `peers.json`:

```json
{
  "peers": [
    "ws://localhost:1813",
    "ws://localhost:1823",
    "ws://192.168.0.15:1813"
  ]
}
```

Each node should list the addresses of other peer nodes. Note: Nodes automatically filter out their own address to prevent self-connections.

#### Method 2: Using Environment Variables

```bash
export PEERS='["ws://localhost:1813","ws://localhost:1823"]'
export NODE_HOST=192.168.0.14  # Optional: specify your node's IP
node rpcServer.js --port 1812 --ws 1813
```

### Command Line Arguments

- `--port <number>`: REST API port (default: 1812)
- `--ws <number>`: WebSocket server port (default: 1813)

### Node Behavior

When a node starts, it will:

1. Generate a unique UUID (`nodeId`)
2. Initialize blockchain instance
3. Start REST API server
4. Start WebSocket server for local clients
5. Load peer list from `peers.json` or `PEERS` environment variable
6. Connect to all peer nodes via Socket.IO client
7. Announce itself to connected peers
8. Begin listening for blockchain events and client connections

### Automatic Reconnection

If a peer node goes offline:

- The connection is detected and logged: `[NODE] Disconnected: <nodeId>...`
- Node attempts automatic reconnection every 5 seconds
- On successful reconnection: `[NODE] Connected: <nodeId>... at <address>`
- Peer socket registry is restored automatically

---

## REST API Endpoints

### `GET /`

Health check and basic node information.

**Response:**
```json
{
  "message": "PlatariumGateway v1.0.0 is running with platarium-network",
  "nodeId": "072bd62f-7473-446f-a490-73dabd70b66a",
  "nodeAddress": "ws://192.168.0.134:1813",
  "connectedPeers": 3
}
```

### `GET /network`

Full network status including all connected peer nodes.

**Response:**
```json
{
  "nodeId": "072bd62f-7473-446f-a490-73dabd70b66a",
  "nodeAddress": "ws://192.168.0.134:1813",
  "connectedNodes": [
    {
      "nodeId": "a1b2c3d4-5678-90ab-cdef-123456789abc",
      "address": "ws://192.168.0.135:1813",
      "host": "192.168.0.135",
      "port": 1813
    },
    {
      "nodeId": "f9e8d7c6-5432-10ba-edcb-987654321def",
      "address": "ws://192.168.0.136:1823",
      "host": "192.168.0.136",
      "port": 1823
    }
  ]
}
```

### `GET /sockets`

Complete overview of all connected WebSocket clients across the entire network.

**Response:**
```json
{
  "nodeId": "072bd62f-7473-446f-a490-73dabd70b66a",
  "nodeAddress": "ws://192.168.0.134:1813",
  "connectedSockets": [
    {
      "socketId": "51rahc7PzglDvO7WAAAB",
      "ipAddress": "::ffff:127.0.0.1",
      "connectedAt": "2025-11-01T14:22:33.511Z",
      "nodeId": "072bd62f-7473-446f-a490-73dabd70b66a"
    },
    {
      "socketId": "PhhAGE5svAJ5amiSAAAD",
      "ipAddress": "::ffff:192.168.0.15",
      "connectedAt": "2025-11-01T14:23:10.918Z",
      "nodeId": "a1b2c3d4-5678-90ab-cdef-123456789abc"
    },
    {
      "socketId": "Xyz123ABC456DEF",
      "ipAddress": "::ffff:192.168.0.16",
      "connectedAt": "2025-11-01T14:24:15.234Z",
      "nodeId": "f9e8d7c6-5432-10ba-edcb-987654321def"
    }
  ],
  "summary": {
    "connectedClients": 3,
    "connectedPeers": 2
  }
}
```

**Socket Object Fields:**
- `socketId`: Unique Socket.IO identifier for the WebSocket client
- `ipAddress`: Client's IP address
- `connectedAt`: ISO timestamp when connection was established
- `nodeId`: UUID of the node where this client is connected (the node that hosts this client)

**Summary Fields:**
- `connectedClients`: Total number of WebSocket clients across **all nodes** (local + peer node clients). This includes all regular clients connected to any node in the network.
- `connectedPeers`: Number of **peer nodes** currently connected. This is the count of other gateway instances that this node is connected to via WebSocket.

**Important Notes:**
- `connectedClients` counts all WebSocket clients (regular users/scripts) across all nodes in the network
- `connectedPeers` counts the number of other gateway nodes (peer instances), not clients
- Each entry in `connectedSockets` includes a `nodeId` indicating which gateway node that client is connected to
- The endpoint automatically queries peer nodes for their socket lists when called
- Both local and remote client sockets are included in the response

### `GET /pg-bal/:address`

Get balance of an address.

### `GET /pg-tx/:hash`

Get transaction by hash.

### `GET /pg-alltx/:address`

Get all transactions for an address.

### `POST /pg-sendtx`

Send a new signed transaction. Transaction events are automatically broadcast to all peer nodes.

---

## Logging

The gateway logs important events to the console with structured prefixes:

### Node Events
- `[NODE] Initialized node: <nodeId> at <address>` - Node startup
- `[NODE] Connected: <nodeId>... at <address>` - Peer node connected
- `[NODE] Disconnected: <nodeId>...` - Peer node disconnected
- `[NODE] Broadcasted <eventType> to <count> node(s)` - Event broadcasted

### Socket Events
- `[SOCKET] Client connected: <id> (IP: <ip>)` - Local client connected
- `[SOCKET] Client disconnected: <id>` - Local client disconnected
- `[WS] New client connected on <nodeId>... (IP: <ip>)` - Client connected on peer node
- `[WS] Client disconnected on <nodeId>...` - Client disconnected on peer node

### Transaction Events
- `Processing transaction: from <from> to <to> amount <amount>` - Transaction processing
- `Transaction added with hash: <hash>, Fee: <fee> coreon` - Transaction completed
- `Transaction error: <error>` - Transaction failed

---

## Testing

### Test Multi-Node Setup

1. **Start Node 1:**
   ```bash
   node rpcServer.js --port 1812 --ws 1813
   ```

2. **Start Node 2** (in another terminal):
   ```bash
   # Update peers.json to include Node 1
   node rpcServer.js --port 1822 --ws 1823
   ```

3. **Verify Connection:**
   - Check logs for: `[NODE] Connected: ...`
   - Call `GET http://localhost:1812/network` - should show Node 2
   - Call `GET http://localhost:1822/network` - should show Node 1

4. **Test Socket Registry:**
   - Connect a WebSocket client to Node 1
   - Connect another client to Node 2
   - Call `GET http://localhost:1812/sockets` - should show both clients
   - Call `GET http://localhost:1822/sockets` - should show both clients

5. **Test Blockchain Event Propagation:**
   - Send a transaction via REST API to Node 1
   - Verify transaction appears on Node 2's clients
   - Check logs for broadcast messages

### Test Automatic Reconnection

1. Start two nodes
2. Verify they connect
3. Stop one node
4. Observe logs: `[NODE] Disconnected: ...`
5. Restart the stopped node
6. Observe logs: `[NODE] Connected: ...` (after 5 seconds)
7. Verify network status is restored

### Test Client Connection Propagation

1. Start two connected nodes
2. Connect a WebSocket client to Node 1
3. Check `GET http://localhost:1822/sockets` - should show the client
4. Disconnect the client
5. Check `GET http://localhost:1822/sockets` - client should be removed

---

## Network Recovery

The system includes automatic network recovery mechanisms:

1. **Peer Reconnection**: Nodes automatically attempt to reconnect to peers every 5 seconds if disconnected
2. **Socket Registry Sync**: When peers reconnect, they automatically query each other for current socket lists
3. **Event Recovery**: While disconnected, nodes continue to serve local clients. On reconnection, new events are immediately synchronized
4. **Self-Connection Prevention**: Nodes automatically filter their own address from peer lists to prevent connection loops

---

## Architecture Notes

### P2P Design Principles

- **No Central Authority**: All nodes operate independently
- **Equal Hierarchy**: No master/slave relationships
- **Symmetric Communication**: Each node is both server and client
- **Fault Tolerance**: Network continues to function even if some nodes go offline
- **Eventual Consistency**: All nodes eventually see the same blockchain state

### Data Synchronization

- **Blockchain Events**: Propagated via `blockchain:event` with origin tracking
- **Client Registry**: Maintained through `client:connected`/`client:disconnected` events
- **Socket Queries**: On-demand via `sockets:request`/`sockets:response`
- **Node Discovery**: Automatic via `node:announce` events

---

## License

MIT License © Platarium Network

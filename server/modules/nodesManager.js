// server/modules/nodesManager.js
import { io as ClientIO } from 'socket.io-client';
import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class NodesManager {
  constructor(nodePort, nodeHost = 'localhost') {
    this.nodeId = randomUUID();
    this.nodeHost = nodeHost;
    this.nodePort = nodePort;
    this.nodeAddress = `ws://${nodeHost}:${nodePort}`;
    
    this.connectedNodes = new Map(); // Map<nodeId, { socket, address, host, port }>
    this.reconnectTimers = new Map(); // Map<address, timer>
    
    // Registry for peer node sockets: Map<nodeId, Map<socketId, { socketId, ipAddress, connectedAt, nodeId }>>
    this.peerSocketsRegistry = new Map();
    
    // Function to get local sockets (set by socketServer)
    this.getLocalSockets = null;
    
    this.peers = this.loadPeers();
    this.eventCallbacks = {
      onNodeConnected: [],
      onNodeDisconnected: [],
      onClientConnected: [],
      onClientDisconnected: []
    };
    
    console.log(`[NODE] Initialized node: ${this.nodeId} at ${this.nodeAddress}`);
  }

  loadPeers() {
    const peers = [];
    
    // Try to load from peers.json
    const peersJsonPath = join(__dirname, '../../peers.json');
    if (existsSync(peersJsonPath)) {
      try {
        const data = readFileSync(peersJsonPath, 'utf-8');
        const config = JSON.parse(data);
        if (Array.isArray(config.peers)) {
          peers.push(...config.peers);
        }
        console.log(`[NODE] Loaded ${peers.length} peers from peers.json`);
      } catch (error) {
        console.error(`[NODE] Error loading peers.json:`, error.message);
      }
    }
    
    // Try to load from environment variable
    if (process.env.PEERS) {
      try {
        const envPeers = JSON.parse(process.env.PEERS);
        if (Array.isArray(envPeers)) {
          peers.push(...envPeers);
        }
      } catch (error) {
        console.error(`[NODE] Error parsing PEERS env variable:`, error.message);
      }
    }
    
    // Filter out self
    return peers.filter(peer => {
      const peerAddress = typeof peer === 'string' ? peer : peer.address;
      return peerAddress !== this.nodeAddress;
    });
  }

  async connectToPeers() {
    for (const peer of this.peers) {
      const address = typeof peer === 'string' ? peer : peer.address;
      await this.connectToNode(address);
    }
  }

  async connectToNode(address) {
    // Don't connect to self
    if (address === this.nodeAddress) {
      return;
    }

    // Don't connect if already connected
    for (const [nodeId, nodeInfo] of this.connectedNodes.entries()) {
      if (nodeInfo.address === address) {
        return; // Already connected
      }
    }

    try {
      const socket = ClientIO(address, {
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionAttempts: Infinity,
        timeout: 5000,
        transports: ['websocket']
      });

      socket.on('connect', () => {
        console.log(`[NODE] Connected: ${socket.id || 'unknown'} at ${address}`);
        
        // Clear any reconnection timer
        if (this.reconnectTimers.has(address)) {
          clearTimeout(this.reconnectTimers.get(address));
          this.reconnectTimers.delete(address);
        }

        // Register this node
        socket.emit('node:announce', {
          nodeId: this.nodeId,
          address: this.nodeAddress,
          host: this.nodeHost,
          port: this.nodePort
        });
      });

      socket.on('disconnect', (reason) => {
        console.log(`[NODE] Disconnected from ${address}: ${reason}`);
        this.handleNodeDisconnected(address);
        this.scheduleReconnect(address);
      });

      socket.on('connect_error', (error) => {
        console.log(`[NODE] Connection error to ${address}: ${error.message}`);
        this.scheduleReconnect(address);
      });

      // Handle node announcements
      socket.on('node:announce', (data) => {
        const { nodeId, address: nodeAddress, host, port } = data;
        if (nodeId === this.nodeId) {
          return; // Ignore self
        }

        this.connectedNodes.set(nodeId, {
          socket,
          address: nodeAddress,
          host,
          port
        });

        console.log(`[NODE] Connected: ${nodeId.substring(0, 8)}... at ${nodeAddress}`);
        
        // Query peer node for its socket list
        if (socket.connected) {
          socket.emit('sockets:request');
        }
        
        // Emit callbacks
        this.eventCallbacks.onNodeConnected.forEach(cb => {
          cb({ nodeId, address: nodeAddress, host, port });
        });
      });

      // Handle blockchain events from other nodes
      socket.on('blockchain:event', (event) => {
        this.handleBlockchainEvent(event);
      });

      // Handle client connection announcements
      socket.on('client:connected', (data) => {
        const { nodeId, clientId, ip, connectedAt } = data;
        if (nodeId !== this.nodeId) {
          console.log(`[WS] New client connected on ${nodeId.substring(0, 8)}... (IP: ${ip})`);
          
          // Update peer sockets registry
          if (!this.peerSocketsRegistry.has(nodeId)) {
            this.peerSocketsRegistry.set(nodeId, new Map());
          }
          const nodeSockets = this.peerSocketsRegistry.get(nodeId);
          nodeSockets.set(clientId, {
            socketId: clientId,
            ipAddress: ip,
            connectedAt: connectedAt || new Date().toISOString(),
            nodeId: nodeId
          });
          
          this.eventCallbacks.onClientConnected.forEach(cb => {
            cb({ nodeId, clientId, ip });
          });
        }
      });

      // Handle client disconnection announcements
      socket.on('client:disconnected', (data) => {
        const { nodeId, clientId } = data;
        if (nodeId !== this.nodeId) {
          console.log(`[WS] Client disconnected on ${nodeId.substring(0, 8)}...`);
          
          // Remove from peer sockets registry
          const nodeSockets = this.peerSocketsRegistry.get(nodeId);
          if (nodeSockets) {
            nodeSockets.delete(clientId);
            if (nodeSockets.size === 0) {
              this.peerSocketsRegistry.delete(nodeId);
            }
          }
          
          this.eventCallbacks.onClientDisconnected.forEach(cb => {
            cb({ nodeId, clientId });
          });
        }
      });

      // Handle socket list requests from peer nodes
      socket.on('sockets:request', () => {
        if (this.getLocalSockets) {
          const localSockets = this.getLocalSockets();
          socket.emit('sockets:response', {
            nodeId: this.nodeId,
            sockets: localSockets
          });
        }
      });

      // Handle socket list responses from peer nodes
      socket.on('sockets:response', (data) => {
        const { nodeId, sockets } = data;
        if (nodeId !== this.nodeId && Array.isArray(sockets)) {
          const nodeSocketsMap = new Map();
          sockets.forEach(socket => {
            nodeSocketsMap.set(socket.socketId, socket);
          });
          this.peerSocketsRegistry.set(nodeId, nodeSocketsMap);
        }
      });

      // Wait a bit for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);

        socket.once('connect', () => {
          clearTimeout(timeout);
          resolve();
        });

        socket.once('connect_error', (error) => {
          clearTimeout(timeout);
          // Don't reject - just resolve (we'll retry later)
          resolve();
        });
      }).catch(() => {
        // Connection failed, will retry
      });

    } catch (error) {
      console.error(`[NODE] Error connecting to ${address}:`, error.message);
      this.scheduleReconnect(address);
    }
  }

  scheduleReconnect(address) {
    if (this.reconnectTimers.has(address)) {
      return; // Already scheduled
    }

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(address);
      this.connectToNode(address);
    }, 5000); // Retry after 5 seconds

    this.reconnectTimers.set(address, timer);
  }

  handleNodeDisconnected(address) {
    let nodeIdToRemove = null;
    for (const [nodeId, nodeInfo] of this.connectedNodes.entries()) {
      if (nodeInfo.address === address) {
        nodeIdToRemove = nodeId;
        break;
      }
    }

    if (nodeIdToRemove) {
      const nodeInfo = this.connectedNodes.get(nodeIdToRemove);
      this.connectedNodes.delete(nodeIdToRemove);
      
      // Remove peer sockets registry for disconnected node
      this.peerSocketsRegistry.delete(nodeIdToRemove);
      
      console.log(`[NODE] Disconnected: ${nodeIdToRemove.substring(0, 8)}...`);
      
      this.eventCallbacks.onNodeDisconnected.forEach(cb => {
        cb({ nodeId: nodeIdToRemove, address: nodeInfo.address });
      });
    }
  }

  // Broadcast blockchain event to all connected nodes (except origin)
  broadcastBlockchainEvent(eventType, data, originNodeId = null) {
    const event = {
      type: eventType,
      data,
      timestamp: Date.now(),
      originNodeId: originNodeId || this.nodeId
    };

    let broadcastCount = 0;
    for (const [nodeId, nodeInfo] of this.connectedNodes.entries()) {
      // Skip origin node if specified
      if (originNodeId && nodeId === originNodeId) {
        continue;
      }

      if (nodeInfo.socket && nodeInfo.socket.connected) {
        nodeInfo.socket.emit('blockchain:event', event);
        broadcastCount++;
      }
    }

    if (broadcastCount > 0) {
      console.log(`[NODE] Broadcasted ${eventType} to ${broadcastCount} node(s)`);
    }

    return broadcastCount;
  }

  // Handle incoming blockchain events from other nodes
  handleBlockchainEvent(event) {
    const { type, data, originNodeId } = event;

    // Prevent loops - ignore events we originated
    if (originNodeId === this.nodeId) {
      return;
    }

    // Re-broadcast to other nodes (not back to origin)
    this.broadcastBlockchainEvent(type, data, originNodeId);

    // Emit to local clients
    if (this.emitToClients) {
      this.emitToClients(type, data);
    }
  }

  // Announce client connection/disconnection to other nodes
  announceClientConnected(clientId, ip, connectedAt) {
    const announcement = {
      nodeId: this.nodeId,
      clientId,
      ip,
      connectedAt: connectedAt || new Date().toISOString()
    };

    for (const [nodeId, nodeInfo] of this.connectedNodes.entries()) {
      if (nodeInfo.socket && nodeInfo.socket.connected) {
        nodeInfo.socket.emit('client:connected', announcement);
      }
    }
  }

  announceClientDisconnected(clientId) {
    const announcement = {
      nodeId: this.nodeId,
      clientId
    };

    for (const [nodeId, nodeInfo] of this.connectedNodes.entries()) {
      if (nodeInfo.socket && nodeInfo.socket.connected) {
        nodeInfo.socket.emit('client:disconnected', announcement);
      }
    }
  }

  // Register callbacks
  on(event, callback) {
    if (this.eventCallbacks[event]) {
      this.eventCallbacks[event].push(callback);
    }
  }

  // Get connected nodes info
  getConnectedNodes() {
    return Array.from(this.connectedNodes.entries()).map(([nodeId, info]) => ({
      nodeId,
      address: info.address,
      host: info.host,
      port: info.port
    }));
  }

  // Set callback for emitting to local clients
  setClientEmitter(emitToClients) {
    this.emitToClients = emitToClients;
  }

  // Set function to get local sockets
  setSocketRegistryGetter(getLocalSockets) {
    this.getLocalSockets = getLocalSockets;
  }

  // Get all connected sockets (local + peer nodes)
  getConnectedSockets() {
    const allSockets = [];
    
    // Add local sockets
    if (this.getLocalSockets) {
      const localSockets = this.getLocalSockets();
      allSockets.push(...localSockets);
    }
    
    // Add peer node sockets
    for (const [nodeId, socketsMap] of this.peerSocketsRegistry.entries()) {
      for (const [socketId, socketInfo] of socketsMap.entries()) {
        allSockets.push(socketInfo);
      }
    }
    
    return allSockets;
  }

  // Query peer nodes for their socket lists
  async queryPeerSockets() {
    for (const [nodeId, nodeInfo] of this.connectedNodes.entries()) {
      if (nodeInfo.socket && nodeInfo.socket.connected) {
        nodeInfo.socket.emit('sockets:request');
      }
    }
    
    // Wait a bit for responses
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  getNodeId() {
    return this.nodeId;
  }

  getNodeAddress() {
    return this.nodeAddress;
  }
}


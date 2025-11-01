// server/modules/socketServer.js
import { createServer } from 'http';
import { Server } from 'socket.io';

export async function createSocketServer(port = 3004, blockchain, nodesManager) {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  const txQueue = [];
  let processing = false;

  // Socket registry: Map<socketId, { socketId, ipAddress, connectedAt, nodeId }>
  const socketRegistry = new Map();

  // Set up client emitter for nodesManager
  if (nodesManager) {
    nodesManager.setClientEmitter((eventType, data) => {
      // Emit blockchain events from other nodes to local clients
      if (eventType === 'transactionProcessed') {
        io.emit('transactionProcessed', data);
      } else if (eventType === 'transactionError') {
        io.emit('transactionError', data);
      } else if (eventType === 'balanceUpdate') {
        io.emit('balanceUpdate', data);
      } else if (eventType === 'blockConfirmed') {
        io.emit('blockConfirmed', data);
      }
    });
  }

  async function processQueue() {
    if (processing) return;
    processing = true;

    while (txQueue.length > 0) {
      const txData = txQueue.shift();
      try {
        console.log(
          `Processing transaction: from ${txData.from} to ${txData.to} amount ${txData.amount}`
        );

        await blockchain.addTransaction({
          from: txData.from,
          to: txData.to,
          value: txData.amount,
          mnemonic: txData.mnemonic,
          code: txData.code,
          data: txData.data || '',
          nonce: txData.nonce || 0,
          coreonUnits: txData.coreonUnits || 1,
          coreonPrice: txData.coreonPrice || 1,
          chainId: txData.chainId || 1,
          type: txData.type || 'transfer',
          assetType: txData.assetType || 'native',
          contractAddress: txData.contractAddress || null
        });

        const lastTx = blockchain.getLastTransaction();

        console.log(
          `Transaction added with hash: ${lastTx.hash}, Fee: ${lastTx.fee} coreon`
        );

        const eventData = {
          hash: lastTx.hash,
          from: lastTx.from,
          to: lastTx.to,
          value: lastTx.value
        };

        // Emit to local clients
        io.emit('transactionProcessed', eventData);

        // Broadcast to other nodes
        if (nodesManager) {
          nodesManager.broadcastBlockchainEvent('transactionProcessed', eventData);
        }
      } catch (error) {
        console.error('Transaction error:', error.message);
        const errorData = { error: error.message };
        
        // Emit to local clients
        io.emit('transactionError', errorData);
        
        // Broadcast to other nodes
        if (nodesManager) {
          nodesManager.broadcastBlockchainEvent('transactionError', errorData);
        }
      }
    }

    processing = false;
  }

  io.on('connection', (socket) => {
    const clientIp = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() 
      || socket.handshake.address 
      || socket.request.socket.remoteAddress 
      || 'unknown';
    
    const connectedAt = new Date().toISOString();
    const nodeId = nodesManager ? nodesManager.getNodeId() : null;
    
    // Track if this is a peer node connection
    const socketInfo = { isPeerNode: false, peerNodeId: null };

    // Handle node announcements from peer nodes (on server side)
    if (nodesManager) {
      socket.on('node:announce', (data) => {
        const { nodeId: peerNodeIdFromData, address: peerAddress, host, port } = data;
        
        // Register the peer node
        if (nodesManager.connectedNodes) {
          // Update connectedNodes map
          if (!nodesManager.connectedNodes.has(peerNodeIdFromData)) {
            socketInfo.isPeerNode = true;
            socketInfo.peerNodeId = peerNodeIdFromData;
            
            nodesManager.connectedNodes.set(peerNodeIdFromData, {
              socket: socket,
              address: peerAddress,
              host: host,
              port: port
            });
            
            console.log(`[NODE] Peer node registered: ${peerNodeIdFromData.substring(0, 8)}... at ${peerAddress}`);
            
            // Emit callbacks
            if (nodesManager.eventCallbacks && nodesManager.eventCallbacks.onNodeConnected) {
              nodesManager.eventCallbacks.onNodeConnected.forEach(cb => {
                cb({ nodeId: peerNodeIdFromData, address: peerAddress, host, port });
              });
            }
            
            // Query peer node for its socket list
            socket.emit('sockets:request');
          }
        }
        
        // Send our own node announcement back
        socket.emit('node:announce', {
          nodeId: nodeId,
          address: nodesManager.getNodeAddress(),
          host: nodesManager.nodeHost,
          port: nodesManager.nodePort
        });
      });
      
      // Handle socket list requests from peer nodes
      socket.on('sockets:request', () => {
        const localSockets = Array.from(socketRegistry.values());
        socket.emit('sockets:response', {
          nodeId: nodeId,
          sockets: localSockets
        });
      });

      // Handle socket list responses from peer nodes
      socket.on('sockets:response', (data) => {
        const { nodeId: peerNodeIdFromData, sockets } = data;
        if (peerNodeIdFromData && peerNodeIdFromData !== nodeId && Array.isArray(sockets)) {
          const nodeSocketsMap = new Map();
          sockets.forEach(sock => {
            nodeSocketsMap.set(sock.socketId, sock);
          });
          if (nodesManager.peerSocketsRegistry) {
            nodesManager.peerSocketsRegistry.set(peerNodeIdFromData, nodeSocketsMap);
          }
        }
      });
    }

    // Register the socket as a regular client
    // Note: Peer nodes may also be registered here initially, but they're tracked separately
    socketRegistry.set(socket.id, {
      socketId: socket.id,
      ipAddress: clientIp,
      connectedAt: connectedAt,
      nodeId: nodeId
    });

    // Use a small delay to check if this is a peer node before announcing as client
    // Peer nodes typically send node:announce immediately
    setTimeout(() => {
      // Only announce as client if it's not a peer node
      if (!socketInfo.isPeerNode && !socket.disconnected) {
        console.log(`[SOCKET] Client connected: ${socket.id} (IP: ${clientIp})`);
        
        // Announce client connection to other nodes
        if (nodesManager) {
          nodesManager.announceClientConnected(socket.id, clientIp, connectedAt);
        }
      }
    }, 100); // Small delay to allow node:announce to be received first

    socket.on('newTransaction', (txData) => {
      txQueue.push(txData);
      processQueue();
    });

    socket.on('disconnect', () => {
      if (socketInfo.isPeerNode && socketInfo.peerNodeId && nodesManager) {
        // Handle peer node disconnection
        nodesManager.connectedNodes.delete(socketInfo.peerNodeId);
        if (nodesManager.peerSocketsRegistry) {
          nodesManager.peerSocketsRegistry.delete(socketInfo.peerNodeId);
        }
        console.log(`[NODE] Peer node disconnected: ${socketInfo.peerNodeId.substring(0, 8)}...`);
        
        if (nodesManager.eventCallbacks && nodesManager.eventCallbacks.onNodeDisconnected) {
          nodesManager.eventCallbacks.onNodeDisconnected.forEach(cb => {
            cb({ nodeId: socketInfo.peerNodeId });
          });
        }
      }
      
      // Remove from client registry (for both peer nodes and regular clients)
      socketRegistry.delete(socket.id);
      
      // Announce client disconnection only if it was a regular client
      if (!socketInfo.isPeerNode) {
        console.log(`[SOCKET] Client disconnected: ${socket.id}`);
        
        // Announce client disconnection to other nodes
        if (nodesManager) {
          nodesManager.announceClientDisconnected(socket.id);
        }
      }
    });
  });

  // Function to get all connected sockets
  const getConnectedSockets = () => {
    return Array.from(socketRegistry.values());
  };

  httpServer.listen(port, () => {
    console.log(`Socket.io server listening on port ${port}`);
  });

  process.stdin.resume();
  console.log("Socket server is running and will stay alive indefinitely.");

  // Function to broadcast events
  const broadcastEvent = (eventType, data) => {
    io.emit(eventType, data);
    if (nodesManager) {
      nodesManager.broadcastBlockchainEvent(eventType, data);
    }
  };

  // Store getConnectedSockets reference for NodesManager
  if (nodesManager) {
    nodesManager.setSocketRegistryGetter(getConnectedSockets);
  }

  return { io, broadcastEvent, getConnectedSockets };
}

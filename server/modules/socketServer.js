// server/modules/socketServer.js
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Blockchain } from 'platarium-network';

export async function createSocketServer(port = 3004) {
  const blockchain = new Blockchain();
  await blockchain.init();
  console.log("Blockchain initialized for Socket.io server");

  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  const txQueue = [];
  let processing = false;

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

        io.emit('transactionProcessed', {
          hash: lastTx.hash,
          from: lastTx.from,
          to: lastTx.to,
          value: lastTx.value
        });
      } catch (error) {
        console.error('Transaction error:', error.message);
        io.emit('transactionError', { error: error.message });
      }
    }

    processing = false;
  }

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('newTransaction', (txData) => {
      txQueue.push(txData);
      processQueue();
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  httpServer.listen(port, () => {
    console.log(`Socket.io server listening on port ${port}`);
  });

  process.stdin.resume();
  console.log("Socket server is running and will stay alive indefinitely.");

  return io;
}

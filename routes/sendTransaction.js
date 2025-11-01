// routes/sendTransaction.js
export async function sendTransactionRoute(app, blockchain, nodesManager) {
  app.post("/pg-sendtx", async (req, res) => {
    const { from, to, amount } = req.body;
    try {
      // Try to get transaction details using the same format as socketServer
      let tx;
      if (typeof blockchain.addTransaction === 'function') {
        // Check if addTransaction accepts object format (like in socketServer)
        try {
          const result = await blockchain.addTransaction({
            from,
            to,
            value: amount,
            mnemonic: req.body.mnemonic,
            code: req.body.code,
            data: req.body.data || '',
            nonce: req.body.nonce || 0,
            coreonUnits: req.body.coreonUnits || 1,
            coreonPrice: req.body.coreonPrice || 1,
            chainId: req.body.chainId || 1,
            type: req.body.type || 'transfer',
            assetType: req.body.assetType || 'native',
            contractAddress: req.body.contractAddress || null
          });
          tx = result;
        } catch {
          // If object format doesn't work, try simple format
          tx = await blockchain.addTransaction(from, to, amount);
        }
      } else {
        tx = blockchain.addTransaction(from, to, amount);
      }

      // Get transaction details
      let txDetails = tx;
      if (blockchain.getLastTransaction) {
        try {
          const lastTx = blockchain.getLastTransaction();
          if (lastTx) {
            txDetails = lastTx;
          }
        } catch {
          // getLastTransaction might not be available
        }
      }

      // Broadcast transaction event to other nodes
      if (nodesManager && txDetails && txDetails.hash) {
        const eventData = {
          hash: txDetails.hash,
          from: txDetails.from || from,
          to: txDetails.to || to,
          value: txDetails.value || amount
        };
        nodesManager.broadcastBlockchainEvent('transactionProcessed', eventData);
      }

      res.json({ success: true, transaction: tx || txDetails });
    } catch (err) {
      // Broadcast error to other nodes
      if (nodesManager) {
        nodesManager.broadcastBlockchainEvent('transactionError', { error: err.message });
      }
      res.status(400).json({ error: err.message });
    }
  });
}

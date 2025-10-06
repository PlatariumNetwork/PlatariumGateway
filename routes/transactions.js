// routes/transactions.js
export function transactionsRoute(app, blockchain) {
  app.get("/pg-alltx/:address", (req, res) => {
    const { address } = req.params;
    const txs = blockchain.getTransactionsByAddress(address);
    res.json(txs);
  });
}

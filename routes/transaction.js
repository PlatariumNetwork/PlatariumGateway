// routes/transaction.js
export function transactionRoute(app, blockchain) {
  app.get("/pg-tx/:hash", (req, res) => {
    const { hash } = req.params;
    const tx = blockchain.getTransaction(hash);
    if (!tx) {
      return res.status(404).json({ error: "Transaction not found" });
    }
    res.json(tx);
  });
}

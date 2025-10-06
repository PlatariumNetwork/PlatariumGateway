// routes/sendTransaction.js
export function sendTransactionRoute(app, blockchain) {
  app.post("/pg-sendtx", (req, res) => {
    const { from, to, amount } = req.body;
    try {
      const tx = blockchain.addTransaction(from, to, amount);
      res.json({ success: true, transaction: tx });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}

// routes/balance.js
export function balanceRoute(app, blockchain) {
  app.get("/pg-bal/:address", (req, res) => {
    const { address } = req.params;
    const balance = blockchain.getBalance(address);
    res.json({ address, balance });
  });
}

// Webhook handler — minimal, just acknowledges receipt
export default function webhooksRoute(req, res) {
  const topic = req.headers['x-shopify-topic'];
  console.log(`Webhook received: ${topic}`);
  // No processing needed — we fetch live data on each page load
  res.status(200).send('OK');
}

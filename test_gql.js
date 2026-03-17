const fetch = require('node-fetch');

async function test() {
  const q1 = { query: `{ rates(symbol: "USDC", limit: 10000, resolution: "1D", startDate: "2026-03-03", endDate: "2026-03-17") { timestamp apy ethPrice } }` };
  const res1 = await fetch("http://127.0.0.1:8081/graphql", { method: 'POST', body: JSON.stringify(q1), headers: {'Content-Type': 'application/json'}});
  console.log("rates:", await res1.text());

  const q2 = { query: `{ ethPrices(limit: 10000, resolution: "1D") { timestamp price } }` };
  const res2 = await fetch("http://127.0.0.1:8081/graphql", { method: 'POST', body: JSON.stringify(q2), headers: {'Content-Type': 'application/json'}});
  console.log("ethPrices:", await res2.text());
}
test();

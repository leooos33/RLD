import useSWR from "swr";

const RATES_GQL_URL = "/rates-graphql";

const SUSDE_QUERY = `{ latestRates { susde } }`;

const gqlFetcher = async (url) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: SUSDE_QUERY }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
};

/**
 * Fetches real-time sUSDe staking yield from the rates-indexer GraphQL API.
 * Returns { stakingYield, protocolYield, avg30d, avg90d, isLoading, error }
 */
export function useSusdeYield() {
  const { data, error, isLoading } = useSWR(RATES_GQL_URL, gqlFetcher, {
    refreshInterval: 60000,
    dedupingInterval: 30000,
    revalidateOnFocus: false,
  });

  const yieldPct = data?.latestRates?.susde ?? null;

  return {
    stakingYield: yieldPct,
    protocolYield: yieldPct,
    avg30d: yieldPct, // single latest value used as fallback
    avg90d: yieldPct,
    lastUpdated: null,
    isLoading,
    error,
  };
}

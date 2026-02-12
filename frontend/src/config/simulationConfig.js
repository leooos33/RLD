/**
 * Simulation stack configuration.
 * Reads from the indexer API running alongside the Anvil fork.
 *
 * Contract addresses are fetched dynamically from the indexer at runtime
 * via /api/market-info, so they survive simulation restarts.
 */

export const SIM_API =
  import.meta.env.VITE_SIM_API_URL || "http://localhost:8080";

export const ZERO_FOR_ONE_LONG = false;

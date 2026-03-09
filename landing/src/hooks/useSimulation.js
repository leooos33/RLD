import { useState, useEffect, useMemo, useRef } from 'react'
import useSWR from 'swr'

// In dev: Vite proxy forwards /graphql and /api/* to https://rld.fi (vite.config.js)
// In prod: nginx already proxies these paths from demo.rld.fi
const GQL_URL = '/graphql'
const SIM_API = ''

const gqlFetcher = ([url, query]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
    .then(r => { if (!r.ok) throw new Error(`GQL HTTP ${r.status}`); return r.json() })
    .then(r => { if (r.errors) console.warn('[GQL]', r.errors); return r.data })

const restFetcher = url => fetch(url).then(r => r.json())

const SIM_QUERY = `
  query SimSnapshot {
    latest {
      blockNumber
      market {
        blockNumber blockTimestamp marketId normalizationFactor
        totalDebt lastUpdateTimestamp indexPrice
      }
      pool {
        poolId tick markPrice liquidity sqrtPriceX96
        token0Balance token1Balance feeGrowthGlobal0 feeGrowthGlobal1
      }
      brokers {
        address collateral debt collateralValue debtValue healthFactor
      }
    }
    volume { volumeUsd swapCount }
    volumeHistory(hours: 168, bucketHours: 1) { timestamp volumeUsd swapCount }
    marketInfo {
      collateral { name symbol address }
      positionToken { name symbol address }
      brokerFactory
      infrastructure {
        brokerRouter brokerExecutor twammHook bondFactory
        poolFee tickSpacing poolManager v4Quoter
        v4PositionManager v4PositionDescriptor v4StateView
        universalRouter permit2
      }
      riskParams {
        minColRatio maintenanceMargin liqCloseFactor fundingPeriodSec debtCap
      }
    }
    status { totalBlockStates totalEvents lastIndexedBlock }
  }
`

export function useSimulation({ pollInterval = 5000, chartResolution = '1H' } = {}) {
  const [connected, setConnected] = useState(false)
  const prevBlock = useRef(null)

  const { data: gqlData, error: gqlError, isLoading: gqlLoading } = useSWR(
    [GQL_URL, SIM_QUERY],
    gqlFetcher,
    {
      refreshInterval: pollInterval,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
      keepPreviousData: true,
      onSuccess: () => setConnected(true),
      onError: () => setConnected(false),
    }
  )

  const chartUrl = `${SIM_API}/api/chart/price?resolution=${chartResolution}&limit=1000`
  const { data: chartRaw } = useSWR(chartUrl, restFetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
    keepPreviousData: false,
  })

  const latest = gqlData?.latest

  const marketInfo = useMemo(() => {
    if (!gqlData?.marketInfo) return null
    const mi = gqlData.marketInfo
    return {
      collateral: mi.collateral,
      position_token: mi.positionToken,
      broker_factory: mi.brokerFactory,
      infrastructure: mi.infrastructure ? {
        broker_router: mi.infrastructure.brokerRouter,
        broker_executor: mi.infrastructure.brokerExecutor,
        twamm_hook: mi.infrastructure.twammHook,
        bond_factory: mi.infrastructure.bondFactory,
        pool_fee: mi.infrastructure.poolFee,
        tick_spacing: mi.infrastructure.tickSpacing,
        pool_manager: mi.infrastructure.poolManager,
        v4_quoter: mi.infrastructure.v4Quoter,
        v4_position_manager: mi.infrastructure.v4PositionManager,
        v4_position_descriptor: mi.infrastructure.v4PositionDescriptor,
        v4_state_view: mi.infrastructure.v4StateView,
        universal_router: mi.infrastructure.universalRouter,
        permit2: mi.infrastructure.permit2,
      } : null,
      risk_params: mi.riskParams ? {
        min_col_ratio: mi.riskParams.minColRatio,
        maintenance_margin: mi.riskParams.maintenanceMargin,
        liq_close_factor: mi.riskParams.liqCloseFactor,
        funding_period_sec: mi.riskParams.fundingPeriodSec,
        debt_cap: mi.riskParams.debtCap,
      } : null,
    }
  }, [gqlData?.marketInfo])

  const market = useMemo(() => {
    if (!latest?.market) return null
    const ms = latest.market
    return {
      marketId: ms.marketId,
      blockNumber: ms.blockNumber,
      blockTimestamp: ms.blockTimestamp,
      normalizationFactor: parseInt(ms.normalizationFactor) / 1e18,
      totalDebt: parseInt(ms.totalDebt) / 1e6,
      indexPrice: parseInt(ms.indexPrice) / 1e18,
      lastUpdateTimestamp: ms.lastUpdateTimestamp,
    }
  }, [latest])

  const pool = useMemo(() => {
    if (!latest?.pool) return null
    const ps = latest.pool
    return {
      poolId: ps.poolId,
      markPrice: ps.markPrice,
      tick: ps.tick,
      liquidity: ps.liquidity,
      sqrtPriceX96: ps.sqrtPriceX96,
      token0Balance: parseInt(ps.token0Balance || '0'),
      token1Balance: parseInt(ps.token1Balance || '0'),
    }
  }, [latest])

  const poolTVL = useMemo(() => {
    if (!pool) return 0
    const t0 = pool.token0Balance / 1e6
    const t1 = pool.token1Balance / 1e6
    const price = pool.markPrice || 1
    return t0 * price + t1
  }, [pool])

  const brokers = useMemo(() => {
    if (!latest?.brokers?.length) return []
    return latest.brokers.map(bp => ({
      address: bp.address,
      collateral: parseInt(bp.collateral) / 1e6,
      debt: parseInt(bp.debt) / 1e6,
      collateralValue: parseInt(bp.collateralValue) / 1e6,
      debtValue: parseInt(bp.debtValue) / 1e6,
      healthFactor: bp.healthFactor,
    }))
  }, [latest])

  const protocolStats = useMemo(() => {
    if (!brokers?.length || !market) return null
    const totalCollateral = brokers.reduce((s, b) => s + b.collateralValue, 0)
    const totalDebtUnits = brokers.reduce((s, b) => s + b.debt, 0)
    const totalDebtUsd = totalDebtUnits * market.indexPrice
    return { totalCollateral, totalDebtUnits, totalDebtUsd }
  }, [brokers, market])

  const chartData = useMemo(() => {
    if (!chartRaw?.data?.length) return []
    return chartRaw.data.map(d => ({
      timestamp: d.timestamp,
      indexPrice: d.index_price,
      markPrice: d.mark_price || null,
      normalizationFactor: d.normalization_factor,
    }))
  }, [chartRaw])

  // 24h price change from chart
  const oracleChange24h = useMemo(() => {
    if (!market || !chartData?.length) return null
    const nowPrice = market.indexPrice
    const earliest = chartData[chartData.length - 1]
    if (!earliest?.indexPrice) return null
    return ((nowPrice - earliest.indexPrice) / earliest.indexPrice) * 100
  }, [market, chartData])

  // Block change detection
  const [blockChanged, setBlockChanged] = useState(false)
  useEffect(() => {
    if (!latest?.blockNumber) return
    if (prevBlock.current !== null && latest.blockNumber !== prevBlock.current) {
      setBlockChanged(true)
      const t = setTimeout(() => setBlockChanged(false), 300)
      return () => clearTimeout(t)
    }
    prevBlock.current = latest.blockNumber
  }, [latest?.blockNumber])

  // APY derived from indexPrice (annualized %)
  const apy = market?.indexPrice ? market.indexPrice * 100 : null

  return {
    connected,
    loading: gqlLoading && !gqlData,
    error: gqlError,
    market,
    pool,
    poolTVL,
    protocolStats,
    marketInfo,
    chartData,
    oracleChange24h,
    brokers,
    blockChanged,
    apy,
    blockNumber: latest?.blockNumber || null,
    volumeData: gqlData?.volume ?? null,
    volumeHistory: gqlData?.volumeHistory ?? [],
  }
}

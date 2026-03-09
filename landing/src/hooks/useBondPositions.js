import { useCallback } from 'react'
import useSWR from 'swr'

// Relative URL — proxied by Vite dev server and nginx in prod
const fetcher = (url) => fetch(url).then((r) => r.json())

export function useBondPositions(account, entryRate, pollInterval = 15000) {
  const apiUrl = account
    ? `/api/bonds?owner=${account.toLowerCase()}&status=all&enrich=true`
    : null

  const { data, mutate, isLoading } = useSWR(apiUrl, fetcher, {
    refreshInterval: pollInterval,
    revalidateOnFocus: false,
    dedupingInterval: 2000,
    keepPreviousData: true,
  })

  const bonds = (data?.bonds || [])
    .filter((b) => b.status === 'active')
    .map((b) => {
      const notional = b.notional_usd || 0
      const rate = entryRate || 0
      const elapsedDays = b.elapsed_days || 0
      const accrued = notional * (rate / 100) * (elapsedDays / 365)
      return {
        id: b.bond_id,
        brokerAddress: b.broker_address,
        principal: notional,
        debtTokens: b.debt_usd || 0,
        fixedRate: rate,
        maturityDays: b.maturity_days || 0,
        elapsed: elapsedDays,
        remaining: b.remaining_days || 0,
        maturityDate: b.maturity_date || '—',
        frozen: b.frozen || false,
        isMatured: b.is_matured || false,
        accrued,
        freeCollateral: b.free_collateral || 0,
        orderId: b.order_id || '0x' + '0'.repeat(64),
        hasActiveOrder: b.has_active_order || false,
        txHash: b.created_tx || null,
        status: b.status,
      }
    })

  const optimisticClose = useCallback(
    (brokerAddress) => {
      mutate(
        (prev) => {
          if (!prev?.bonds) return prev
          return {
            ...prev,
            bonds: prev.bonds.filter(
              (b) => b.broker_address.toLowerCase() !== brokerAddress.toLowerCase()
            ),
            count: (prev.count || 1) - 1,
          }
        },
        { revalidate: true }
      )
    },
    [mutate]
  )

  const optimisticCreate = useCallback(
    (brokerAddress, notionalUsd, durationHours) => {
      mutate(
        (prev) => {
          const existing = prev?.bonds || []
          const newBond = {
            broker_address: brokerAddress,
            owner: account?.toLowerCase(),
            status: 'active',
            notional_usd: notionalUsd,
            debt_usd: notionalUsd,
            free_collateral: 0,
            remaining_days: Math.ceil(durationHours / 24),
            elapsed_days: 0,
            maturity_days: Math.ceil(durationHours / 24),
            is_matured: false,
            frozen: false,
            has_active_order: true,
            bond_id: parseInt(brokerAddress.slice(-4), 16) % 10000,
            maturity_date: '—',
            created_tx: null,
          }
          return { bonds: [newBond, ...existing], count: existing.length + 1 }
        },
        { revalidate: true }
      )
    },
    [mutate, account]
  )

  return {
    bonds,
    loading: isLoading && !data,
    refresh: () => mutate(),
    optimisticClose,
    optimisticCreate,
  }
}

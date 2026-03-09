export const formatUSD = (val) => {
  if (val == null || isNaN(val)) return '—'
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
  if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`
  return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export const formatPct = (val, decimals = 2) => {
  if (val == null || isNaN(val)) return '—'
  return `${val.toFixed(decimals)}%`
}

export const formatPrice = (val) => {
  if (val == null || isNaN(val)) return '—'
  if (val >= 1000) return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (val >= 1) return `$${val.toFixed(4)}`
  return `$${val.toFixed(6)}`
}

export const formatNum = (val, decimals = 2) => {
  if (val == null || isNaN(val)) return '—'
  return val.toFixed(decimals)
}

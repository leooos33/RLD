import { useBondPositions } from '../hooks/useBondPositions'
import { useBondExecution } from '../hooks/useBondExecution'
import { useWallet } from '../hooks/useWallet'
import { formatUSD, formatPct } from '../utils/helpers'

function ProgressBar({ elapsed, total }) {
  const pct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0
  return (
    <div className="w-full h-[2px] bg-white/5 mt-1">
      <div className="h-full bg-white/25 transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function YourBondsTable({ apy, marketInfo }) {
  const { address } = useWallet()
  const { bonds, loading, optimisticClose } = useBondPositions(address, apy)

  const infra = marketInfo?.infrastructure
  const { closeBond, executing, step } = useBondExecution(
    address, infra,
    marketInfo?.collateral?.address,
    marketInfo?.position_token?.address,
  )

  const handleClose = (bond) => {
    if (executing) return
    optimisticClose(bond.brokerAddress)
    closeBond(bond.brokerAddress, () => {})
  }

  return (
    <div className="border border-[#141414] bg-[#0b0b0b]">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#141414] flex items-center justify-between">
        <span className="font-mono font-bold text-[11px] tracking-[0.28em] uppercase text-white">
          Your Bonds
        </span>
        {executing && (
          <span className="font-mono text-[10px] tracking-[0.15em] text-[#555]">{step}</span>
        )}
      </div>

      {/* Column headers */}
      {bonds.length > 0 && (
        <div className="hidden md:grid grid-cols-[auto_1fr_1fr_1fr_1fr_auto] gap-x-6 px-5 py-2
                        border-b border-[#141414] bg-[#080808]">
          {['#', 'Rate', 'Principal', 'Maturity', 'Accrued', ''].map((h) => (
            <span key={h} className="font-mono text-[10px] tracking-[0.18em] uppercase text-[#666]">{h}</span>
          ))}
        </div>
      )}

      {/* Empty / loading states */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <svg className="animate-spin text-[#2a2a2a]" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="24" strokeDashoffset="8"/>
          </svg>
        </div>
      )}

      {!loading && !address && (
        <div className="flex items-center justify-center py-12">
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">Connect wallet to view bonds</span>
        </div>
      )}

      {!loading && address && bonds.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#333]">No active bonds</span>
        </div>
      )}

      {/* Bond rows */}
      {bonds.map((bond) => (
        <div
          key={bond.id}
          className="px-5 py-4 border-b border-[#141414] last:border-b-0
                     flex flex-col md:grid md:grid-cols-[auto_1fr_1fr_1fr_1fr_auto] gap-y-3 md:gap-x-6 md:items-center"
        >
          {/* ID */}
          <div className="font-mono text-[11px] text-[#444]">
            #{String(bond.id).padStart(4, '0')}
          </div>

          {/* Rate */}
          <div className="flex flex-col gap-0.5">
            <span className="md:hidden font-mono text-[9px] text-[#444] uppercase tracking-[0.2em]">Rate</span>
            <span className="font-mono text-[13px] text-[#ccc]">{formatPct(bond.fixedRate)}</span>
          </div>

          {/* Principal */}
          <div className="flex flex-col gap-0.5">
            <span className="md:hidden font-mono text-[9px] text-[#444] uppercase tracking-[0.2em]">Principal</span>
            <span className="font-mono text-[13px] text-[#ccc]">{formatUSD(bond.principal)}</span>
          </div>

          {/* Maturity + progress */}
          <div className="flex flex-col gap-0.5">
            <span className="md:hidden font-mono text-[9px] text-[#444] uppercase tracking-[0.2em]">Maturity</span>
            <span className="font-mono text-[13px] text-[#ccc]">{bond.remaining}d left</span>
            <ProgressBar elapsed={bond.elapsed} total={bond.maturityDays} />
          </div>

          {/* Accrued */}
          <div className="flex flex-col gap-0.5">
            <span className="md:hidden font-mono text-[9px] text-[#444] uppercase tracking-[0.2em]">Accrued</span>
            <span className="font-mono text-[13px] text-[#ccc]">{formatUSD(bond.accrued)}</span>
          </div>

          {/* Close button */}
          <div className="flex justify-end">
            <button
              onClick={() => handleClose(bond)}
              disabled={executing || bond.frozen}
              className="font-mono text-[11px] text-[#444] hover:text-white transition-colors duration-200
                         disabled:opacity-30 disabled:cursor-not-allowed px-1"
              title={bond.isMatured ? 'Collect yield' : 'Close bond early'}
            >
              {bond.isMatured ? 'Collect' : '×'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

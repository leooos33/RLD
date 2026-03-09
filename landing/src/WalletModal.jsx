import { useEffect } from 'react'

/* ── Grain overlay ── */
const Grain = () => (
  <div
    className="pointer-events-none absolute inset-0 opacity-25"
    style={{
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`,
      backgroundSize: '192px 192px',
    }}
  />
)

/* ── Wallet option row ── */
function WalletOption({ icon, label, description, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-5 px-6 py-5 border-b border-[#141414]
                 hover:bg-[#111] transition-colors duration-200 group text-left
                 disabled:opacity-40 disabled:cursor-not-allowed
                 last:border-b-0"
    >
      <div className="w-9 h-9 border border-[#1a1a1a] bg-[#0d0d0d] flex items-center justify-center shrink-0 group-hover:border-[#333] transition-colors duration-200">
        <span className="text-[16px] leading-none select-none">{icon}</span>
      </div>
      <div className="flex flex-col gap-[3px]">
        <span className="font-mono text-[13px] tracking-[0.12em] uppercase text-[#ccc] group-hover:text-white transition-colors duration-200">
          {label}
        </span>
        <span className="font-mono text-[10px] text-[#444] group-hover:text-[#666] transition-colors duration-200">
          {description}
        </span>
      </div>
      <svg className="ml-auto text-[#2a2a2a] group-hover:text-[#666] transition-colors duration-200"
        width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M1 9L9 1M9 1H3M9 1V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  )
}

/* ── Balance row ── */
function BalanceRow({ label, value, loading }) {
  const displayValue = loading || value == null ? '···' : value
  const dim = loading || value == null
  return (
    <div className="flex items-center justify-between py-2">
      <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-[#666]">{label}</span>
      <span
        className="font-mono"
        style={{ fontSize: '14px', lineHeight: 1, color: dim ? '#555' : '#999' }}
      >
        {displayValue}
      </span>
    </div>
  )
}



/* ══════════════════════════════════════
   WALLET MODAL
══════════════════════════════════════ */
export default function WalletModal({
  open, onClose,
  address, connecting, connError,
  ethBalance, usdcBalance,
  onConnect, onDisconnect,
  shortAddress,
  faucet,
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const isConnected = !!address
  const loadingBalances = isConnected && ethBalance === null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.78)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-[400px] border border-[#141414] bg-[#0b0b0b] overflow-hidden">
        <Grain />

        {/* ── Header ── */}
        <div className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-[#141414]">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[#333] text-[11px]">|—</span>
            <span className="font-mono text-[11px] tracking-[0.28em] uppercase text-[#555]">
              {isConnected ? 'Wallet' : 'Connect'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-[18px] text-[#333] hover:text-white transition-colors duration-200 leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* ══ CONNECTED ══ */}
        {isConnected ? (
          <div className="relative z-10">

            {/* Address + copy */}
            <div className="px-6 pt-5 pb-4 border-b border-[#141414]">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-1.5 h-1.5 bg-white shrink-0" />
                <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#666]">Connected</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-[14px] tracking-[0.06em] text-white">
                  {shortAddress(address)}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(address)}
                  title="Copy address"
                  className="text-[#666] hover:text-white transition-colors duration-200 shrink-0"
                  aria-label="Copy address"
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <rect x="4.5" y="4.5" width="7" height="7" rx="0" stroke="currentColor" strokeWidth="1.1"/>
                    <path d="M2.5 8.5H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5a1 1 0 0 1 1 1v.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Balances */}
            <div className="px-6 py-1 border-b border-[#141414]">
              <BalanceRow
                label="ETH"
                value={ethBalance !== null ? `${ethBalance} ETH` : null}
                loading={loadingBalances}
              />
              <BalanceRow
                label="USDC"
                value={usdcBalance !== null ? `${usdcBalance} USDC` : null}
                loading={loadingBalances}
              />
            </div>

            {/* Faucet */}
            <div className="px-6 py-5 border-b border-[#141414]">
              <button
                onClick={faucet.request}
                disabled={faucet.loading || faucet.done}
                className="w-full flex items-center justify-between px-5 py-4 border border-[#141414]
                           hover:border-[#333] hover:bg-[#111] transition-all duration-200 group
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex flex-col gap-[3px] text-left">
                  <span className="font-mono text-[14px] tracking-[0.06em] uppercase text-[#888] group-hover:text-white transition-colors duration-200">
                    {faucet.done ? '✓ Faucet Claimed' : faucet.loading ? faucet.step || 'Working…' : 'Request Faucet'}
                  </span>
                  <span className="font-mono text-[11px] text-[#666] group-hover:text-[#888] transition-colors duration-200">
                    {faucet.done ? '100k USDC + 10 ETH sent' : '100k USDC + 10 ETH testnet tokens'}
                  </span>
                </div>
                {/* Loading spinner or arrow */}
                {faucet.loading ? (
                  <svg className="animate-spin text-[#444] shrink-0" width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20" strokeDashoffset="10"/>
                  </svg>
                ) : faucet.done ? (
                  <span className="font-mono text-[12px] text-[#555]">✓</span>
                ) : (
                  <svg className="text-[#2a2a2a] group-hover:text-[#666] transition-colors duration-200 shrink-0"
                    width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M5.5 1v8M1 6.5l4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>
              {faucet.error && (
                <p className="font-mono text-[9px] text-[#666] mt-2 tracking-[0.06em]">{faucet.error}</p>
              )}
            </div>

            {/* Actions */}
            <div className="px-6 py-5">
              <button
                onClick={onDisconnect}
                className="flex items-center px-5 py-4 border border-[#141414]
                           hover:border-[#333] transition-all duration-200 group"
              >
                <span className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#666] group-hover:text-[#999] transition-colors duration-200">
                  Disconnect
                </span>
              </button>
            </div>
          </div>

        ) : (
        /* ══ DISCONNECTED ══ */
          <div className="relative z-10">
            <div>
              <WalletOption
                icon="🦊"
                label="MetaMask"
                description="Browser extension wallet"
                onClick={onConnect}
                disabled={connecting}
              />
              <WalletOption
                icon="⬡"
                label="WalletConnect"
                description="Mobile & hardware wallets"
                onClick={onConnect}
                disabled={connecting}
              />
              <WalletOption
                icon="⬡"
                label="Coinbase Wallet"
                description="Self-custody wallet"
                onClick={onConnect}
                disabled={connecting}
              />
            </div>

            {connError && (
              <div className="px-6 py-4 border-t border-[#141414]">
                <span className="font-mono text-[10px] tracking-[0.1em] text-[#666]">{connError}</span>
              </div>
            )}

            <div className="px-6 py-4 border-t border-[#141414]">
              <p className="font-mono text-[9px] tracking-[0.08em] text-[#666] leading-[1.8]">
                By connecting, you agree to the{' '}
                <a href="#" className="text-[#888] hover:text-[#999] transition-colors duration-200">Terms of Service</a>.
                This app is on testnet — use test funds only.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

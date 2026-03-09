import { useEffect, useState } from 'react'
import Nav from './Nav'

/* ── Subtle live ticker — only address bytes, fast & quiet ── */
function LiveTicker() {
  const rand = () => Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0')
  const [vals, setVals] = useState(() => Array.from({ length: 3 }, rand))
  useEffect(() => {
    const id = setInterval(() => setVals(p => {
      const n = [...p]; n[Math.floor(Math.random() * 3)] = rand(); return n
    }), 200)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-4 mb-12 select-none" aria-hidden="true">
      {vals.map((v, i) => (
        <span key={i} className="font-mono text-[10px] text-[#2a2a2a] tracking-widest">{v}</span>
      ))}
      <span className="font-mono text-[10px] text-[#222] tracking-widest">— LIVE</span>
    </div>
  )
}


/* ══════════════════════════════════════════
   HERO
══════════════════════════════════════════ */
export default function Hero() {
  const [vis, setVis] = useState(false)
  useEffect(() => { const t = setTimeout(() => setVis(true), 80); return () => clearTimeout(t) }, [])

  return (
    <div className="min-h-screen bg-[#080808] flex flex-col">

      {/* grain */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-30"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`,
          backgroundSize: '192px 192px',
        }}
      />

      {/* ─── NAV ─── */}
      <Nav />

      {/* ─── MAIN ─── */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-8 md:px-14 py-12 lg:ml-[120px]">
        <div className={`w-full max-w-[800px] transition-all duration-700 ${vis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'}`}>

          <LiveTicker />

          {/* HEADLINE */}
          <h1 className="mb-5 leading-[1.08] lg:tracking-[-0.025em]">
            <span className="block text-white font-['Space_Grotesk'] font-light"
              style={{ fontSize: 'clamp(35px, 5.5vw, 62px)' }}>
              Interest Rate Derivatives
            </span>
            <span className="block text-[#666] font-['Space_Grotesk'] font-light"
              style={{ fontSize: 'clamp(35px, 5.5vw, 62px)' }}>
              for On-Chain Finance
            </span>
          </h1>

          {/* TAGLINE */}
          <p className="text-[14px] text-[#999] tracking-[0.05em] mb-8">
            Fix yields.&nbsp; Trade rates.&nbsp; Insure solvency.
          </p>

          {/* BODY */}
          <div className="space-y-5 mb-12 max-w-[600px]">
            <p className="text-[13px] leading-[1.9] text-[#888]">
              <span className="text-white tracking-[0.12em] uppercase text-[11px] mr-2">Synthetic Bonds</span>
              Lock in today's rates — fix your yield or borrowing cost for leveraged
              basis trading. One pool, any maturity, no liquidity fragmentation and rolls.
            </p>
            <p className="text-[13px] leading-[1.9] text-[#888]">
              <span className="text-white tracking-[0.12em] uppercase text-[11px] mr-2">CDS</span>
              Insure underlying pool solvency with 100% payout on bankruptcy.
              Parametric, trustless, and instant settlement.
            </p>
            <p className="text-[13px] leading-[1.9] text-[#888]">
              <span className="text-white tracking-[0.12em] uppercase text-[11px] mr-2">Perps</span>
            Trade interest rates as a volatility instrument. Capitalize on rates &amp; crypto cointegration.
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap items-center gap-10 mb-16 font-bold">
            <a href="https://rld.fi/bonds" id="cta-launch-app-hero"
              className="flex items-center gap-2 px-12 py-[12px] border border-[#555]
                         text-[11px] tracking-[0.22em] uppercase text-white font-mono
                         hover:border-white hover:bg-white hover:text-black
                         transition-all duration-200">
              Launch App ↗
            </a>
            <a href="https://docs.rld.fi" id="cta-docs"
              className="text-[11px] tracking-[0.22em] uppercase text-[#666] font-mono
                         hover:text-[#ccc] transition-colors duration-200 border-b border-transparent
                         hover:border-[#555] pb-[1px]">
              Docs ↗
            </a>
          </div>
        </div>
      </main>

      {/* ── SCROLL INDICATOR ── */}
      <div className={`
        absolute bottom-14 left-1/2 -translate-x-1/2 z-10
        flex flex-col items-center gap-2
        transition-opacity duration-700 delay-[600ms]
        ${vis ? 'opacity-100' : 'opacity-0'}
      `}>
        <span className="font-mono text-[8px] tracking-[0.35em] uppercase text-[#333]">Scroll</span>
        <div className="flex flex-col items-center gap-[3px]">
          {[0, 1, 2].map(i => (
            <svg
              key={i}
              width="10" height="6"
              viewBox="0 0 10 6"
              fill="none"
              className="text-[#333]"
              style={{
                animation: `scrollArrow 1.6s ease-in-out ${i * 0.18}s infinite`,
                opacity: 0,
              }}
            >
              <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ))}
        </div>
        <style>{`
          @keyframes scrollArrow {
            0%   { opacity: 0; transform: translateY(-4px); }
            40%  { opacity: 1; }
            80%  { opacity: 0; transform: translateY(4px);  }
            100% { opacity: 0; }
          }
        `}</style>
      </div>

      {/* FOOTER */}
      <footer className="relative z-10 flex items-center justify-between px-8 md:px-14 py-3 border-t border-[#111]">
        <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-[#666]">Testnet Live</span>
        <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-[#666]">V.01 / Experimental Beta</span>
      </footer>

    </div>
  )
}

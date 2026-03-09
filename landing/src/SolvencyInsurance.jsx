import { useEffect, useRef, useState } from 'react'

function useInView(threshold = 0.1) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setInView(true) },
      { threshold }
    )
    if (ref.current) obs.observe(ref.current)
    return () => obs.disconnect()
  }, [])
  return [ref, inView]
}

/* ── Stat ── */
function Stat({ value, label }) {
  return (
    <div className="border-l border-[#1e1e1e] pl-5">
      <div className="font-['Space_Grotesk'] font-light text-white leading-none mb-1"
        style={{ fontSize: 'clamp(24px, 2.8vw, 36px)' }}>
        {value}
      </div>
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-[#444]">{label}</div>
    </div>
  )
}

/* ── Risk card ── */
function RiskCard({ index, title, description, inView, delay }) {
  return (
    <div
      className="relative border border-[#141414] bg-[#0d0d0d] p-7 flex flex-col gap-5 transition-all duration-600"
      style={{
        transitionDelay: `${delay}ms`,
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(18px)',
      }}
    >
      {/* Corner marks */}
      <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#1e1e1e]" />
      <span className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#1e1e1e]" />

      <div className="flex items-start justify-between">
        <span className="font-mono text-[9px] tracking-[0.3em] text-[#252525]">0{index}</span>
        <span className="font-mono text-[8px] tracking-[0.22em] uppercase text-[#1e1e1e] border border-[#181818] px-2 py-[2px]">
          Covered
        </span>
      </div>

      <h3 className="font-['Space_Grotesk'] font-light text-white leading-[1.15] tracking-[-0.01em]"
        style={{ fontSize: 'clamp(18px, 2vw, 24px)' }}>
        {title}
      </h3>

      <p className="font-mono text-[11px] leading-[1.85] text-[#666] flex-1">
        {description}
      </p>

      {/* Bottom indicator line */}
      <div className="h-px w-8 bg-[#222]" />
    </div>
  )
}

/* ══════════════════════════════════════
   SECTION
══════════════════════════════════════ */
export default function SolvencyInsurance() {
  const [headerRef, headerInView] = useInView(0.05)
  const [bodyRef, bodyInView] = useInView(0.05)
  const [cardsRef, cardsInView] = useInView(0.05)

  return (
    <section className="relative bg-[#080808] min-h-screen flex flex-col justify-center px-8 md:px-14 py-20 lg:py-28 border-t border-[#111]">

      {/* grain */}
      <div className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`,
          backgroundSize: '192px 192px',
        }}
      />

      <div className="relative z-10 max-w-[1100px] mx-auto w-full">

        {/* Section label */}
        <div
          ref={headerRef}
          className="flex items-center gap-3 mb-14 transition-all duration-500"
          style={{ opacity: headerInView ? 1 : 0, transform: headerInView ? 'translateY(0)' : 'translateY(10px)' }}
        >
          <span className="font-mono text-[#333] text-[11px]">|—</span>
          <span className="font-mono text-[12px] tracking-[0.28em] uppercase text-[#333]">Solvency Insurance</span>
          <span className="flex-1 h-px bg-[#141414]" />
        </div>

        {/* Headline + stats row */}
        <div
          ref={bodyRef}
          className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16 transition-all duration-600"
          style={{ opacity: bodyInView ? 1 : 0, transform: bodyInView ? 'translateY(0)' : 'translateY(16px)' }}
        >
          {/* Headline */}
          <div>
            <h2
              className="font-['Space_Grotesk'] font-light text-white leading-[1.1] tracking-[-0.02em] mb-6"
              style={{ fontSize: 'clamp(28px, 3.5vw, 46px)' }}
            >
              Insure Protocol<br />
              <span className="text-[#666]">Solvency On-Chain</span>
            </h2>
            <p className="font-mono text-[12px] leading-[1.9] text-[#666] max-w-[460px] mb-8">
              Protocol insolvency is DeFi's largest unpriced tail risk.
              RLD Credit Default Swaps let you hedge it — parametric trigger,
              trustless execution, and 100% notional payout.
            </p>
            <a
              href="https://rld.fi/bonds"
              className="inline-flex items-center gap-2 px-6 py-[11px] border border-white
                         font-mono text-[10px] tracking-[0.22em] uppercase text-white
                         hover:bg-white hover:text-black transition-all duration-200"
            >
              Explore CDS <span className="text-[#666]">↗</span>
            </a>
          </div>

          {/* Stats */}
          <div className="flex flex-col justify-center">
            <div className="grid grid-cols-2 gap-y-8 gap-x-6">
              <Stat value="100%" label="Payout on trigger" />
              <Stat value="Instant" label="Settlement" />
              <Stat value="Parametric" label="Trigger mechanism" />
              <Stat value="Trustless" label="No manual claim" />
            </div>
          </div>
        </div>

        {/* Risk cards — 4 columns */}
        <div ref={cardsRef} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <RiskCard
            index={1}
            inView={cardsInView}
            delay={0}
            title="Depeg Event"
            description="Stablecoin or LST depegs from its target, collapsing the pool's collateral value faster than liquidations can fire."
          />
          <RiskCard
            index={2}
            inView={cardsInView}
            delay={80}
            title="Oracle Failure"
            description="A manipulated or stale price feed triggers mass liquidations at incorrect prices, leaving the protocol insolvent. Parametric trigger activates on confirmed health breach."
          />
          <RiskCard
            index={3}
            inView={cardsInView}
            delay={160}
            title="Security Exploit"
            description="Funds drained via a reentrancy attack, logic bug, or upgrade vulnerability. If the exploit collapses the health factor below threshold, CDS settlement fires automatically."
          />
          <RiskCard
            index={4}
            inView={cardsInView}
            delay={240}
            title="Bad Debt"
            description="Underwater positions accumulate past the protocol's reserves — common in high-leverage or illiquid markets. RLD tracks the health factor in real time and settles instantly."
          />
        </div>

      </div>
    </section>
  )
}

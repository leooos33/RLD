import { useEffect, useRef, useState } from 'react'

function useInView(threshold = 0.15) {
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

/* ── Metric row ── */
function Metric({ label, value }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[#141414] py-3">
      <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[#555]">{label}</span>
      <span className="font-mono text-[12px] text-[#999]">{value}</span>
    </div>
  )
}

/* ── Use case card ── */
function UseCase({ tag, title, subtitle, description, metrics, cta, ctaHref = 'https://rld.fi/bonds', delay = 0 }) {
  const [ref, inView] = useInView()

  return (
    <div
      ref={ref}
      className="relative border border-[#141414] bg-[#111] flex flex-col transition-all duration-700"
      style={{
        transitionDelay: `${delay}ms`,
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(20px)',
      }}
    >
      {/* Corner marks */}
      <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-[#222]" />
      <span className="absolute top-0 right-0 w-2 h-2 border-t border-r border-[#222]" />
      <span className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-[#222]" />
      <span className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-[#222]" />

      {/* Main content */}
      <div className="px-8 pt-8 pb-6 flex-1">
        <h3
          className="font-['Space_Grotesk'] font-light text-white leading-[1.15] tracking-[-0.02em] mb-2"
          style={{ fontSize: 'clamp(22px, 2.8vw, 34px)' }}
        >
          {title}
        </h3>
        <p className="font-mono text-[11px] tracking-[0.08em] text-[#666] mb-8">{subtitle}</p>

        <p className="font-mono text-[12px] leading-[1.9] text-[#666] mb-10 max-w-[480px]">
          {description}
        </p>

        {/* Metrics */}
        <div className="mb-10">
          {metrics.map((m) => <Metric key={m.label} {...m} />)}
        </div>
      </div>

      {/* CTA */}
      <div className="px-8 pb-8">
        <a
          href={ctaHref}
          className="inline-flex items-center gap-2 px-6 py-[11px] border border-white
                     font-mono text-[10px] tracking-[0.22em] uppercase text-white
                     hover:bg-white hover:text-black
                     transition-all duration-200"
        >
          {cta}
        </a>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════
   SECTION
══════════════════════════════════════ */
export default function UseCases() {
  const [ref, inView] = useInView(0.05)

  return (
    <section className="relative bg-[#080808] px-8 md:px-14 py-20 lg:py-28 min-h-screen flex flex-col justify-center">

      {/* grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`,
          backgroundSize: '192px 192px',
        }}
      />

      <div className="relative z-10 max-w-[1100px] mx-auto w-full">

        {/* Section label */}
        <div
          ref={ref}
          className="flex items-center gap-3 mb-14 transition-all duration-500"
          style={{ opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(10px)' }}
        >
          <span className="font-mono text-[#333] text-[11px]">|—</span>
          <span className="font-mono text-[12px] tracking-[0.28em] uppercase text-[#333]">Synthetic Bonds</span>
          <span className="flex-1 h-px bg-[#141414]" />
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          <UseCase
            tag="Fixed Yield"
            title="Fixed Yield"
            subtitle="Lock in your rate for any maturity"
            description={
              `Deposit into an RLD pool and take the fixed-rate side of an interest rate swap. ` +
              `Your yield is locked at entry — regardless of how floating rates move. `
            }
            metrics={[
              { label: 'Underlying Yield', value: 'Lending protocols & T-bills' },
              { label: 'Maturity', value: 'Any — from 1 hour to 1 year' },
              { label: 'Deposit token', value: 'USDC / USDT / SOFR rates' },
              { label: 'Settlement', value: 'Instant, on-chain' },
              { label: 'Exit', value: 'Permissionless, no lockup' },
            ]}
            cta="Explore Fixed Yields ↗"
            ctaHref="https://rld.fi/bonds"
            delay={0}
          />

          <UseCase
            tag="Basis Trade"
            title="Fixed-Rate Leverage"
            subtitle="Trade the spread. Hedge the rate."
            description={
              `Running a delta-neutral basis trade? RLD lets you fix your borrow cost, ` +
              `so you can receive bull market funding while paying a predictable rate.`
            }
            metrics={[
              { label: 'Mechanism', value: 'Long interest rates perps' },
              { label: 'Maturity', value: 'Any — from 1 hour to 1 year' },
              { label: 'Collateral', value: 'USDC, USDT, stETH' },
              { label: 'Risk Removed', value: 'Rate spike → P&L compression' },
              { label: 'Capital', value: 'Collateral-funded, no upfront cost' },
            ]}
            cta="Explore Basis Trading ↗"
            ctaHref="https://rld.fi/strategies/basis-trade"
            delay={80}
          />

        </div>

      </div>
    </section>
  )
}

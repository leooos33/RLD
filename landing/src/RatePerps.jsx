import { useEffect, useRef, useState } from "react";

function useInView(threshold = 0.08) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setInView(true);
      },
      { threshold },
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return [ref, inView];
}

/* ── Rate chart — inline SVG showing asymmetric rate profile ── */
function RateChart({ inView }) {
  return (
    <div
      className="relative border border-[#141414] bg-[#0b0b0b] p-6 transition-all duration-700"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(20px)",
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <span className="font-mono text-[9px] tracking-[0.28em] uppercase text-[#2a2a2a]">
          Borrow Rate / Time
        </span>
        <span className="font-mono text-[9px] tracking-[0.2em] uppercase text-[#666]">
          Illustrative
        </span>
      </div>
      <svg viewBox="0 0 320 140" className="w-full" preserveAspectRatio="none">
        {[0, 35, 70, 105, 140].map((y) => (
          <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="#161616" strokeWidth="1" />
        ))}
        <line x1="0" y1="115" x2="320" y2="115" stroke="#222" strokeWidth="1" strokeDasharray="4 4" />
        <text x="6" y="111" fill="#444444" fontSize="7" fontFamily="monospace">FED FLOOR</text>

        <polyline
          points="0,110 40,108 70,105 90,95 100,60 110,30 120,15 135,22 150,45 170,80 190,90 220,100 250,108 280,110 320,110"
          fill="none" stroke="#333" strokeWidth="1.5" strokeLinejoin="round"
        />
        <polyline
          points="90,95 100,60 110,30 120,15 135,22 150,45"
          fill="none" stroke="#888" strokeWidth="1.5" strokeLinejoin="round"
        />
        <circle cx="120" cy="15" r="2.5" fill="#aaa" />
        <text x="124" y="13" fill="#666" fontSize="7" fontFamily="monospace">5–10×</text>
        <circle cx="0" cy="110" r="2" fill="#333" />
      </svg>

      <div className="flex items-center gap-6 mt-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-px bg-[#888]" />
          <span className="font-mono text-[9px] text-[#444]">Demand spike range</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-px bg-[#333]" />
          <span className="font-mono text-[9px] text-[#333]">Baseline range</span>
        </div>
      </div>
    </div>
  );
}

/* ── Feature block ── */
function Feature({ index, label, title, body, inView, delay }) {
  return (
    <div
      className="border-t border-[#141414] pt-6 transition-all duration-600"
      style={{
        transitionDelay: `${delay}ms`,
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(14px)",
      }}
    >
      <div className="flex items-center gap-3 mb-4">
        <span className="font-mono text-[9px] tracking-[0.28em] text-[#999]">0{index}</span>
        <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-[#999] border border-[#1a1a1a] px-2 py-[2px]">
          {label}
        </span>
      </div>
      <h3
        className="font-['Space_Grotesk'] font-light text-white leading-[1.15] tracking-[-0.015em] mb-3"
        style={{ fontSize: "clamp(18px, 2vw, 24px)" }}
      >
        {title}
      </h3>
      <p className="font-mono text-[11px] leading-[1.9] text-[#666]">{body}</p>
    </div>
  );
}

/* ══════════════════════════════════════
   SECTION
══════════════════════════════════════ */
export default function RatePerps() {
  const [headerRef, headerInView] = useInView(0.05);
  const [topRef, topInView] = useInView(0.05);
  const [featRef, featInView] = useInView(0.05);

  return (
    <section className="relative bg-[#080808] min-h-screen flex flex-col justify-center px-8 md:px-14 py-20 lg:py-28 border-t border-[#111]">
      {/* grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-25"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`,
          backgroundSize: "192px 192px",
        }}
      />

      <div className="relative z-10 max-w-[1100px] mx-auto w-full">
        {/* Section label */}
        <div
          ref={headerRef}
          className="flex items-center gap-3 mb-14 transition-all duration-500"
          style={{
            opacity: headerInView ? 1 : 0,
            transform: headerInView ? "translateY(0)" : "translateY(10px)",
          }}
        >
          <span className="font-mono text-[#555] text-[11px]">|—</span>
          <span className="font-mono text-[12px] tracking-[0.28em] uppercase text-[#333]">
            Rate Perpetuals
          </span>
          <span className="flex-1 h-px bg-[#141414]" />
        </div>

        {/* Headline + chart */}
        <div ref={topRef} className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
          <div
            className="transition-all duration-600"
            style={{
              opacity: topInView ? 1 : 0,
              transform: topInView ? "translateY(0)" : "translateY(16px)",
            }}
          >
            <h2
              className="font-['Space_Grotesk'] font-light text-white leading-[1.1] tracking-[-0.02em] mb-6"
              style={{ fontSize: "clamp(28px, 3.5vw, 46px)" }}
            >
              Trade Interest Rates
              <br />
              <span className="text-[#555]">as a Volatility Asset</span>
            </h2>
            <p className="font-mono text-[12px] leading-[1.9] text-[#666] max-w-[440px] mb-8">
              DeFi borrow rates are not symmetric. They have a hard floor at the
              risk-free rate but can surge 5–10× during periods of high leverage
              demand — creating a structurally asymmetric payoff profile that
              perpetual traders can exploit.
            </p>
            <a
              href="https://rld.fi/markets/perps"
              className="inline-flex items-center gap-2 px-6 py-[11px] border border-white
                         font-mono text-[10px] tracking-[0.22em] uppercase text-white
                         hover:bg-white hover:text-black transition-all duration-200"
            >
              Trade Rates <span className="text-[#555]">↗</span>
            </a>
          </div>

          <RateChart inView={topInView} />
        </div>

        {/* 3 feature strips */}
        <div ref={featRef} className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <Feature
            index={1}
            inView={featInView}
            delay={0}
            label="Asymmetry"
            title="Floored by policy, spiked by demand"
            body="The FED rate sets a structural floor — rates almost never go below it. But during increased demand, borrow rates can spike 5–10× overnight. This asymmetry creates attractive asymmetric payoff."
          />
          <Feature
            index={2}
            inView={featInView}
            delay={100}
            label="Cross-Margin"
            title="Unified margin across your entire account"
            body="Margin with ERC20 assets, open limit & TWAP orders, and Uniswap V4 LP positions — all inside a single PrimeBroker. One account, full cross-margin efficiency."
          />
          <Feature
            index={3}
            inView={featInView}
            delay={200}
            label="Volatility"
            title="Rates co-move with market sentiment"
            body="High correlation between interest rates and market sentiment. Traders can go long rates ahead of bull markets or short when they believe the market is overheated and rates will revert."
          />
        </div>
      </div>
    </section>
  );
}

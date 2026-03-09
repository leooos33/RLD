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

/* ══════════════════════════════════════
   SECTION — CTA Footer + Global Footer
══════════════════════════════════════ */
export default function CoreArchitecture() {
  const [ctaRef, ctaInView] = useInView(0.1);

  return (
    <>
      {/* ── CTA FOOTER ── */}
      <section className="relative bg-[#080808] border-t border-[#111] px-8 md:px-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`,
            backgroundSize: "192px 192px",
          }}
        />

        <div
          ref={ctaRef}
          className="relative z-10 max-w-[1100px] mx-auto py-24 lg:py-32 flex flex-col items-center text-center transition-all duration-700"
          style={{
            opacity: ctaInView ? 1 : 0,
            transform: ctaInView ? "translateY(0)" : "translateY(20px)",
          }}
        >
          <h2
            className="font-['Space_Grotesk'] font-light text-white leading-[1.1] tracking-[-0.02em] mb-4"
            style={{ fontSize: "clamp(28px, 4vw, 52px)" }}
          >
            Start Trading Rates
          </h2>
          <p className="font-mono text-[12px] text-[#666] tracking-[0.06em] mb-10 max-w-[400px]">
            Testnet is live. Fix yields, trade rate movements, and insure
            solvency — entirely on-chain.
          </p>

          <div className="flex items-center gap-6 mb-20">
            <a
              href="https://rld.fi/bonds"
              className="flex items-center gap-2 px-10 py-[13px] border border-white
                         font-mono text-[11px] tracking-[0.22em] uppercase text-white font-bold
                         hover:bg-white hover:text-black transition-all duration-200"
            >
              Launch App ↗
            </a>
            <a
              href="https://docs.rld.fi"
              className="font-mono text-[11px] tracking-[0.22em] uppercase text-[#666]
                         hover:text-white transition-colors duration-200"
            >
              Docs ↗
            </a>
          </div>
        </div>

        {/* Footer links */}
        <div className="relative z-10 border-t border-[#1e1e1e]">
          <div className="max-w-[1100px] mx-auto px-8 md:px-14 lg:px-0 pt-6 pb-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <span className="font-mono text-[11px] tracking-[0.3em] uppercase text-white font-bold">
                RLD
              </span>
              <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#888]">
                Ethereum Testnet
              </span>
              <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-[#888]">
                V.01
              </span>
            </div>
            <div className="flex items-center gap-6">
              {[
                { label: "Twitter", href: "https://x.com/rld_fi" },
                { label: "GitHub", href: "#" },
                { label: "Docs", href: "https://docs.rld.fi" },
                { label: "App", href: "https://rld.fi" },
              ].map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#888]
                             hover:text-white transition-colors duration-200"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

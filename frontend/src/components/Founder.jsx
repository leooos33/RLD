import React from "react";
import {
  Terminal,
  ExternalLink,
  Github,
  Twitter,
  Mail,
  MapPin,
  Calendar,
  Briefcase,
  BookOpen,
  GraduationCap,
  Zap,
  ChevronRight,
  Globe,
} from "lucide-react";

// Custom Telegram branded icon
function TelegramIcon({ size = 12, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

// ── Founder photo ─────────────────────────────────────────────
import founderPhoto from "../assets/AV_PIC.jpg";
const FOUNDER_PHOTO = founderPhoto;

// ── Founder data ──────────────────────────────────────────────
const FOUNDER = {
  name: "Yevhen",
  title: "Founder",
  tagline: "Building RLD: fixed-rate layer for DeFi",
  location: "Krakow, Poland",
  email: "yevhen@rld.fi",
  bio: [
    "Placeholder bio paragraph one. Describe your background, what drives you, and how you came to build RLD Protocol.",
    "Placeholder bio paragraph two. Talk about your vision for fixed-rate DeFi infrastructure and what makes RLD unique.",
  ],
  socials: [
    { label: "TWITTER", href: "https://x.com/yevhenx", Icon: Twitter },
    { label: "GITHUB", href: "https://github.com/leooos33", Icon: Github },
    { label: "TELEGRAM", href: "https://t.me/yevhenx", Icon: TelegramIcon },
  ],
  experience: [
    {
      role: "Founder",
      org: "RLD Protocol",
      period: "2025 — Present",
      description:
        "On-chain synthetic bonds and credit-default swaps on Uniswap V4.",
    },
    {
      role: "Founder",
      org: "Lumis",
      period: "2023 — 2024",
      description: "Structured Liquidity Protocol.",
    },
    {
      role: "Founder",
      org: "Liqui Hedgehog",
      period: "2022 — 2023",
      description:
        "An ETH-vault that provides liquidity on Uniswap V3 and hedges its impermanent loss with power perpetuals.",
    },
    {
      role: "Project Owner",
      org: "Minter",
      period: "2019 — 2020",
      description: "RPC provider infrastructure and node operations.",
    },
    {
      role: "Quant",
      org: "JMT",
      period: "2018 — 2019",
      description:
        "Quantitative strategies for perpetual futures market-making.",
    },
    {
      role: "Analyst",
      org: "JMT",
      period: "2017 — 2018",
      description: "Financial analysis and research.",
    },
  ],
  publications: [
    {
      title: "RLD: Rate-Level Derivatives",
      venue: "Whitepaper",
      date: "2026",
      url: "#",
      description:
        "On-chain synthetic bonds and credit-default swaps. Introduces a derivative structure that tracks lending pool interest rates, enabling fixed-yield bonds via TWAMM unwinds and parametric CDS insurance — all unified in a single Uniswap V4 liquidity layer.",
    },
    {
      title: "PDLP: Perpetual Demand Lending Pool",
      venue: "Whitepaper",
      date: "2025",
      url: "#",
      description:
        "A synchronized spot + perpetual futures DEX with built-in dynamic LP hedging and MEV protection. Derives a closed-form mean-variance hedge using Euler lending loops, achieving convex volatility harvesting with constant delta for LPs.",
    },
  ],
  skills: [
    "Solidity",
    "DeFi Protocol Design",
    "Uniswap V4 Hooks",
    "TWAMM",
    "Smart Contract Security",
    "Mechanism Design",
    "Quantitative Finance",
    "Rust",
    "React",
    "Python",
  ],
};

// ── Sub-components ────────────────────────────────────────────

function TimelineItem({ role, org, period, description }) {
  return (
    <div className="relative pl-6 pb-8 last:pb-0 group">
      <div className="absolute left-0 top-1.5 bottom-0 w-px bg-white/10 group-last:bg-transparent" />
      <div className="absolute left-[-3px] top-1.5 w-[7px] h-[7px] bg-pink-500 shadow-[0_0_8px_#ec4899]" />
      <div className="space-y-1">
        <div className="text-xs font-bold text-white uppercase tracking-wide">
          {role}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-pink-400 uppercase tracking-widest font-bold">
            {org}
          </span>
          <span className="text-[10px] text-gray-600">•</span>
          <span className="text-[10px] text-gray-500 uppercase tracking-widest">
            {period}
          </span>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed mt-2 font-mono">
          {description}
        </p>
      </div>
    </div>
  );
}

function PanelHeader({ icon: Icon, title, indicator }) {
  return (
    <div className="p-4 border-b border-white/10 bg-[#0a0a0a] flex justify-between items-center">
      <h3 className="text-xs font-bold tracking-widest text-white uppercase flex items-center gap-2">
        <Icon size={14} className="text-gray-500" />
        {title}
      </h3>
      {indicator && (
        <div className="w-1.5 h-1.5 bg-green-500 animate-pulse shadow-[0_0_8px_#22c55e]" />
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

export default function Founder() {
  return (
    <div className="min-h-screen bg-[#050505] selection:bg-pink-500/30 selection:text-white">
      <div className="max-w-[750px] mx-auto px-4 md:px-6 py-8 md:py-12">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-8 text-[10px] text-gray-600 uppercase tracking-widest">
          <Terminal size={12} />
          <span>RLD://</span>
          <ChevronRight size={10} />
          <span className="text-gray-400">FOUNDER</span>
        </div>

        {/* ═══ IDENTITY CARD — photo left, info right ═══ */}
        <div className="border border-white/10 bg-[#080808] mb-8">
          <div className="flex flex-col md:flex-row">
            {/* Photo */}
            <div className="md:w-48 lg:w-56 flex-shrink-0 bg-[#0a0a0a] overflow-hidden">
              {FOUNDER_PHOTO ? (
                <img
                  src={FOUNDER_PHOTO}
                  alt={FOUNDER.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center">
                  <span className="text-[10px] uppercase tracking-widest text-gray-600">
                    PHOTO
                  </span>
                </div>
              )}
            </div>

            {/* Identity + Contact + Socials */}
            <div className="flex-1 flex flex-col">
              {/* Name / Title / Tagline */}
              <div className="p-6 pb-4">
                <h1 className="text-3xl font-light text-white tracking-tight">
                  {FOUNDER.name}
                </h1>
                <div className="text-[10px] text-pink-400 uppercase tracking-widest font-bold mt-1">
                  {FOUNDER.title}
                </div>
                <div className="text-[10px] text-gray-600 uppercase tracking-widest mt-1">
                  {FOUNDER.tagline}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <GraduationCap
                    size={12}
                    className="text-gray-600 flex-shrink-0"
                  />
                  <span className="text-[10px] text-gray-500 tracking-wide">
                    B.A. in Mechanical Engineering, M.A. in Economics
                  </span>
                </div>
              </div>

              {/* Contact row */}
              <div className="border-t border-white/5 px-6 py-3 flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-2">
                  <MapPin size={12} className="text-gray-600" />
                  <span className="text-xs font-mono text-[#e0e0e0]">
                    {FOUNDER.location}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail size={12} className="text-gray-600" />
                  <span className="text-xs font-mono text-[#e0e0e0]">
                    {FOUNDER.email}
                  </span>
                </div>
              </div>

              {/* Social links row */}
              <div className="border-t border-white/5 px-6 py-3 mt-auto">
                <div className="flex flex-wrap gap-2">
                  {FOUNDER.socials.map((s) => (
                    <a
                      key={s.label}
                      href={s.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-1.5 border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/20 transition-all group"
                    >
                      <s.Icon
                        size={12}
                        className="text-gray-500 group-hover:text-white transition-colors"
                      />
                      <span className="text-[9px] font-bold tracking-widest uppercase text-gray-500 group-hover:text-white transition-colors">
                        {s.label}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ ABOUT ═══ */}
        <div className="border border-white/10 bg-[#080808] mb-8">
          <PanelHeader icon={Terminal} title="ABOUT" indicator />
          <div className="p-6 space-y-4">
            {FOUNDER.bio.map((p, i) => (
              <p
                key={i}
                className="text-sm text-gray-400 leading-relaxed font-mono"
              >
                {p}
              </p>
            ))}
          </div>
        </div>

        {/* ═══ EXPERIENCE ═══ */}
        <div className="border border-white/10 bg-[#080808] mb-8">
          <PanelHeader icon={Calendar} title="EXPERIENCE" />
          <div className="p-6 md:p-8">
            {FOUNDER.experience.map((exp, i) => (
              <TimelineItem key={i} {...exp} />
            ))}
          </div>
        </div>

        {/* ═══ PUBLICATIONS ═══ */}
        <div className="border border-white/10 bg-[#080808] mb-8">
          <PanelHeader icon={BookOpen} title="PUBLICATIONS" />
          <div className="p-6 space-y-4">
            {FOUNDER.publications.map((pub, i) => (
              <a
                key={i}
                href={pub.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block border border-white/5 bg-white/[0.01] hover:bg-white/[0.04] hover:border-white/15 transition-all p-4 group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="text-xs font-bold text-white uppercase tracking-wide group-hover:text-pink-400 transition-colors flex items-center gap-2">
                      {pub.title}
                      <ExternalLink
                        size={10}
                        className="text-gray-600 group-hover:text-pink-400 transition-colors"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-pink-400 uppercase tracking-widest font-bold">
                        {pub.venue}
                      </span>
                      <span className="text-[10px] text-gray-600">•</span>
                      <span className="text-[10px] text-gray-500 uppercase tracking-widest">
                        {pub.date}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 font-mono leading-relaxed mt-1">
                      {pub.description}
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 mb-8 text-center">
          <div className="text-[9px] text-gray-700 uppercase tracking-[0.3em]">
            ── RLD PROTOCOL ── FIXED RATES FOR DEFI ──
          </div>
        </div>
      </div>
    </div>
  );
}

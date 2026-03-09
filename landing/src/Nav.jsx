import { useState, useRef, useEffect } from 'react'
import { useWallet } from './hooks/useWallet'
import WalletModal from './WalletModal'

/* ── NavLink ── */
function NavLink({ children, href = '#', active = false }) {
  return (
    <a
      href={href}
      className={`text-[13px] tracking-[0.15em] uppercase transition-colors duration-200
                  ${active ? 'text-white' : 'text-[#555] hover:text-[#ccc]'}`}
    >
      {children}
    </a>
  )
}

/* ── Markets dropdown ── */
const MARKETS_ITEMS = [
  { label: 'Perps', desc: 'Rate perpetual futures', href: 'https://rld.fi/markets/perps' },
  { label: 'LP Pools', desc: 'Uniswap V4 liquidity', href: 'https://rld.fi/markets/pools' },
]

function MarketsDropdown() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-[6px] text-[13px] tracking-[0.15em] uppercase
                   text-[#555] hover:text-[#ccc] transition-colors duration-200"
        aria-expanded={open}
      >
        Markets
        <svg width="8" height="5" viewBox="0 0 8 5" fill="none"
          className="transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Invisible bridge fills any gap between button and panel */}
      {open && (
        <div className="absolute top-full left-0 w-full h-5" />
      )}

      <div
        className="absolute top-full left-0 mt-[18px] w-[240px] border border-[#141414] bg-[#0b0b0b] transition-all duration-200"
        style={{
          opacity: open ? 1 : 0,
          transform: open ? 'translateY(0)' : 'translateY(-6px)',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {MARKETS_ITEMS.map((item, i) => (
          <a key={item.label} href={item.href}
            onClick={() => setOpen(false)}
            className={`flex flex-col gap-[3px] px-5 py-4 transition-colors duration-200 hover:bg-[#111] group
                        ${i < MARKETS_ITEMS.length - 1 ? 'border-b border-[#141414]' : ''}`}
          >
            <span className="font-mono text-[13px] tracking-[0.15em] uppercase text-[#ccc] group-hover:text-white transition-colors duration-200">
              {item.label}
            </span>
            <span className="font-mono text-[11px] text-[#555] group-hover:text-[#888] transition-colors duration-200">
              {item.desc}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}

/* ── Hamburger icon ── */
function Hamburger({ open }) {
  return (
    <span className="flex flex-col justify-center gap-[5px] w-5 h-5">
      <span className="block h-px bg-white transition-all duration-200 origin-center"
        style={{ transform: open ? 'translateY(6px) rotate(45deg)' : 'none' }} />
      <span className="block h-px bg-white transition-all duration-200"
        style={{ opacity: open ? 0 : 1 }} />
      <span className="block h-px bg-white transition-all duration-200 origin-center"
        style={{ transform: open ? 'translateY(-6px) rotate(-45deg)' : 'none' }} />
    </span>
  )
}

/* ══ NAV ══ */
export default function Nav({ activePage = '' }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [walletOpen, setWalletOpen] = useState(false)
  const { address, connecting, connError, ethBalance, usdcBalance, connect, disconnect, shortAddress, faucet } = useWallet()

  const mobileLinks = [
    { label: 'Bonds', href: '/#/bonds' },
    { label: 'Pools', href: '/#/pools' },
    { label: 'Perps', href: '/#/perps' },
    { label: 'LP Pools', href: 'https://rld.fi/markets/pools', sub: true },
    { label: 'Strategies', href: '/#/strategies' },
    { label: 'Portfolio', href: 'https://rld.fi/portfolio' },
    { label: 'Data', href: '/#/data' },
    { label: 'Docs', href: 'https://docs.rld.fi' },
  ]

  return (
    <>
      <header className="relative z-20 border-b border-[#141414]" style={{ backgroundColor: '#080808' }}>
        <div className="flex items-center justify-between px-8 md:px-14 py-5">
          <div className="flex items-center gap-10">
            {/* Logo */}
            <a href="/" className="flex items-center gap-3">
              <div className="w-[14px] h-[14px] bg-white shrink-0" />
              <span className="font-mono font-bold text-[13px] tracking-[0.2em] uppercase text-white">RLD</span>
            </a>
            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-7 font-bold">
              <NavLink href="/#/bonds" active={activePage === 'bonds'}>Bonds</NavLink>
              <NavLink href="/#/pools" active={activePage === 'pools'}>Pools</NavLink>
              <NavLink href="/#/perps" active={activePage === 'perps'}>Perps</NavLink>
              <MarketsDropdown />
              <NavLink href="/#/strategies" active={activePage === 'strategies'}>Strategies</NavLink>
              <NavLink href="https://rld.fi/portfolio">Portfolio</NavLink>
              <NavLink href="/#/data" active={activePage === 'data'}>Data</NavLink>
              <NavLink href="https://docs.rld.fi">Docs</NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {/* Connect button */}
            <button
              id="cta-connect"
              onClick={() => setWalletOpen(true)}
              className="flex items-center gap-2 px-8 py-[12px] border
                         text-[11px] tracking-[0.22em] uppercase font-mono
                         transition-all duration-200"
              style={address ? { borderColor: '#2a2a2a', color: '#ccc' } : { borderColor: '#555', color: '#fff' }}
              onMouseEnter={e => { if (!address) { e.currentTarget.style.borderColor='#fff'; e.currentTarget.style.background='#fff'; e.currentTarget.style.color='#000' } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=address?'#2a2a2a':'#555'; e.currentTarget.style.background=''; e.currentTarget.style.color=address?'#ccc':'#fff' }}
            >
              {connecting ? 'Connecting…' : address ? shortAddress(address) : 'Connect'}
            </button>

            {/* Hamburger */}
            <button className="lg:hidden p-1" onClick={() => setMenuOpen(o => !o)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}>
              <Hamburger open={menuOpen} />
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        <div
          className="lg:hidden overflow-hidden transition-all duration-300 border-t border-[#141414]"
          style={{ maxHeight: menuOpen ? '360px' : '0px', opacity: menuOpen ? 1 : 0 }}
        >
          <nav className="flex flex-col px-8 py-6 gap-1">
            {mobileLinks.map(l => (
              <a key={l.label} href={l.href} onClick={() => setMenuOpen(false)}
                className={`font-mono text-[12px] tracking-[0.22em] uppercase
                           hover:text-white transition-colors duration-200 py-3
                           border-b border-[#141414] last:border-b-0
                           ${l.sub ? 'pl-5 text-[#555] text-[10px] tracking-[0.2em]' : 'text-[#888]'}`}
              >
                {l.sub && <span className="text-[#333] mr-2">↳</span>}{l.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <WalletModal
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        address={address}
        connecting={connecting}
        connError={connError}
        ethBalance={ethBalance}
        usdcBalance={usdcBalance}
        onConnect={connect}
        onDisconnect={() => { disconnect(); setWalletOpen(false) }}
        shortAddress={shortAddress}
        faucet={faucet}
      />
    </>
  )
}

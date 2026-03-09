# RLD Landing — Design System

> Monospace-first, grayscale, immutable-terminal aesthetic.
> All values are exact. Do not approximate.

---

## Color Palette

| Token | Hex | Usage |
|---|---|---|
| `page-bg` | `#080808` | Root background, nav header |
| `panel-bg` | `#0b0b0b` | All bordered panels and cards |
| `panel-alt` | `#080808` | Alt panel bg (column header rows, table header rows) |
| `border` | `#141414` | All panel/card/divider borders |
| `text-hi` | `#ffffff` | Page titles, active tabs, primary values, button hover |
| `text-mid` | `#ccc` | Normal values, row data, default value color |
| `text-sub` | `#888` | Secondary labels, description text |
| `text-dim` | `#666` | Metric strip labels, column headers (inactive) |
| `text-mute` | `#555` | Muted values, field labels, disabled states |
| `text-ghost` | `#444` | Very muted context text, inactive links |
| `text-faint` | `#333` | Near-invisible, background numerics |
| `text-trace` | `#2a2a2a` | Separators, range dashes, grain artifacts |
| `text-invis` | `#222` | Invisible-but-there text (e.g. disconnected sublabel) |

---

## Typography

All text uses **JetBrains Mono / Space Mono** (Google Fonts monospace stack).
Use `font-mono` for all UI text. The one exception is the landing hero headline (`Space_Grotesk`).

| Role | Size | Tracking | Color |
|---|---|---|---|
| Page title | `13–14px` | `0.3em` | `#fff` |
| Section label | `10px` | `0.28em` | `#555` |
| Metric label | `10px` | `0.22em` | `#666` |
| Metric value | `18px` | — | `#ccc` |
| Table column header | `10px` | `0.2em` | `#666` hover `#ccc` |
| Table cell value | `13px` | `0.1em` | `#ccc` |
| Body / description | `11–12px` | `0.08em` | `#777–#888` |
| Breadcrumb | `11px` | `0.18em` | `#444` |
| Button | `11px` | `0.22em` | varies |
| Bond card APY | `22px` | — | `#fff` |
| Bond card label | `9–10px` | `0.22em` | `#555` |

All labels are `uppercase`. All tracking is positive.

---

## Spacing & Layout

- **Page padding:** `px-6 md:px-14 py-10`
- **Max content width:** `max-w-[1400px] mx-auto`
- **Section gap:** `gap-8` (between major sections)
- **Panel inner padding:** `px-5 py-4` (default) | `px-6 py-5` (metric cells)
- **Table row padding:** `px-6 py-5`

---

## Panels & Borders

Every panel follows this pattern:
```
border border-[#141414] bg-[#0b0b0b]
```

Sub-rows inside panels use:
```
border-b border-[#141414] last:border-b-0
```

Dividers between columns:
```
divide-x divide-[#141414]   /* horizontal divider grid */
divide-y divide-[#141414]   /* vertical divider grid */
```

---

## Components

### MetricCell
```jsx
<div className="flex flex-col gap-2 px-6 py-5 border-r border-[#141414] last:border-r-0">
  <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#666]">{label}</span>
  <span className="font-mono" style={{ fontSize: '18px', lineHeight: 1, color: '#ccc' }}>{value}</span>
</div>
```
Wrap in `grid grid-cols-N divide-x divide-[#141414]` inside `border border-[#141414] bg-[#0b0b0b]`.

### ColHeader (sortable)
```jsx
<button className="font-mono text-[10px] tracking-[0.2em] uppercase
                   text-[#666] hover:text-[#ccc] [active: text-white]">
  {label} <SortIcon />
</button>
```

### Tab Bar
```jsx
// Active tab: border-b border-white text-white
// Inactive tab: text-[#444] hover:text-[#888] border-b border-transparent
```

### Primary Button
```jsx
<button className="border border-[#555] text-white font-mono text-[11px] tracking-[0.22em] uppercase
                   transition-all duration-200 hover:bg-white hover:text-black hover:border-white">
```

### Disabled Button
```jsx
style={{ borderColor: '#333', color: '#555', cursor: 'not-allowed' }}
```

### FieldRow (summary row)
```jsx
<div className="flex items-center justify-between py-3 border-b border-[#141414]">
  <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#555]">{label}</span>
  <span className="font-mono text-[13px] text-[#ccc]">{value}</span>
</div>
```

### Bond Card
```
Border: border border-[#141414]
Header: ■ + title (font-bold tracking-[0.25em]) — #id dim text-[#333]
Data cells: grid-cols-2 divide-x, APY value 22px text-white, label 9px text-[#555]
Footer: ■ status text-white — dim days text-[#555]
```

### Live Status Indicator
```jsx
<span className="w-1.5 h-1.5 shrink-0" style={{ background: connected ? '#fff' : '#2a2a2a' }} />
<span className="font-mono text-[10px] tracking-[0.18em] uppercase"
      style={{ color: connected ? '#444' : '#2a2a2a' }}>
  {connected ? 'Live' : 'Offline'}
</span>
```

### Progress Bar
```jsx
<div className="w-full h-[2px] bg-white/5">
  <div className="h-full bg-white/25" style={{ width: `${pct}%` }} />
</div>
```

---

## Motion

All interactive transitions use `duration-200` with `ease-in-out` (Tailwind default).

| Interaction | Property |
|---|---|
| Link hover | `color` |
| Button hover | `color`, `background`, `border-color` |
| Dropdown open/close | `opacity`, `transform` (translateY ±6px) |
| Mobile drawer | `max-height` (0 → 360px) + `opacity` |
| Spinner | `animate-spin` (Tailwind) |
| Page reveal | `opacity`, `translateY(5px → 0)`, `duration-700` |
| Status dot blink | none — static, state-driven |

---

## Grain Overlay

Applied to every full-page background as a `fixed` overlay:
```jsx
<div
  className="pointer-events-none fixed inset-0 z-0 opacity-30"
  style={{
    backgroundImage: `url("data:image/svg+xml,… fractalNoise …")`,
    backgroundSize: '192px 192px',
  }}
/>
```

The nav header always has `backgroundColor: '#080808'` as an inline style (not Tailwind class)
to guarantee it is never affected by the grain z-stacking.

---

## File Map

```
src/
├── Nav.jsx                    Shared navigation (header + mobile drawer + wallet)
├── WalletModal.jsx            Wallet connection modal
├── context/
│   └── SimulationContext.jsx  Global SWR provider (useSimulation)
├── hooks/
│   ├── useSimulation.js       GraphQL + REST data from /graphql and /api/*
│   ├── useWallet.js           MetaMask connection, ETH/USDC balances, faucet
│   ├── useBondPositions.js    SWR /api/bonds?owner=…&enrich=true
│   ├── useBondExecution.js    mintBond / closeBond via BondFactory
│   └── useTradeLogic.js       Notional + maturity duration state
├── utils/
│   ├── helpers.js             formatUSD / formatPct / formatPrice
│   └── anvil.js               RPC_URL, getAnvilSigner, restoreAnvilChainId
└── bonds/
    ├── BondsPage.jsx          Bond repository (directory)
    ├── BondMarketPage.jsx     Individual market page (trading terminal)
    ├── OrderPanel.jsx         OPEN / CLOSE bond order form
    ├── YourBondsTable.jsx     User's active bond positions
    └── DESIGN_SYSTEM.md       This file
```

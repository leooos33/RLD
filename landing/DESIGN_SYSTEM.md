# RLD Landing — Design System

> **Audience:** Designers and frontend contributors onboarding to this project.
> **Stack:** React + Tailwind CSS v3, Vite. All design values live in `tailwind.config.js` and inline Tailwind classes.

---

## 1. Design Philosophy

The RLD landing page is a **dark, terminal-inspired financial interface**. Every decision should reinforce three qualities:

- **Precision** — data is displayed with the same care as a Bloomberg terminal. Tight spacing, monospace type, minimal decoration.
- **Restraint** — add nothing that doesn't serve information. No gradients, no color accents, no shadows.
- **Legibility at depth** — the page uses many gray levels. Every text element must have a clear role in the brightness hierarchy.

---

## 2. Color Palette

All colors are gray-scale. There are **no accent colors** in the current design.

### Backgrounds

| Token | Hex | Usage |
|---|---|---|
| `bg-base` | `#080808` | Page background, all sections |
| `bg-surface` | `#0b0b0b` | Elevated cards (chart, pillar cards) |
| `bg-card` | `#0d0d0d` | Risk cards, direction cards |
| `bg-card-alt` | `#111` | UseCase cards (slightly lighter) |

### Borders

| Hex | Usage |
|---|---|
| `#111` | Section-level dividers (`border-t` between sections) |
| `#141414` | Component-level borders (cards, metric rows, section rules) |
| `#1a1a1a` | Badge borders (label chips) |
| `#1e1e1e` | Footer border, decorative corner marks |
| `#222` | Very faint decorative lines |

> **Rule:** Use `#141414` for any structural border inside a section. Use `#111` for borders that divide full-width sections.

### Text Brightness Hierarchy

This is the most important table in the design system. Every piece of text must map to one of these levels.

| Level | Hex | Elements |
|---|---|---|
| **1 — Primary** | `#ffffff` | Section headlines (`h2`), card titles (`h3`), CTA buttons, brand wordmark |
| **2 — Secondary** | `#888` – `#999` | Metric values, stat data, footer labels, index numbers on cards |
| **3 — Body** | `#666` | Description paragraphs, subtitle lines, card body text |
| **4 — Label** | `#444` – `#555` | Field labels (uppercase mono), nav links, CTA secondary links |
| **5 — Structural** | `#222` – `#333` | Section tab labels, chart axis text, decorative index numbers |
| **6 — Invisible** | `#141414` – `#1e1e1e` | Borders, badge backgrounds — not readable, purely structural |

> **Rule:** Adjacent text elements must differ by **at least one full level**. Never use the same hex for two visually co-located elements of different semantic importance.

---

## 3. Typography

### Font Families

| Family | Weight | Use |
|---|---|---|
| `Space Grotesk` | `300` (light) | Headlines only (`h1`, `h2`, `h3`) |
| `JetBrains Mono` | `300`, `400`, `500`, `700` | Everything else — labels, body, data, buttons, nav |

> **Rule:** Never use `Space Grotesk` for body copy or labels. Never use `JetBrains Mono` for headlines.

### Type Scale

All headline sizes use `clamp()` for fluid responsive scaling:

| Element | Size |
|---|---|
| `h1` (Hero) | `clamp(35px, 5.5vw, 62px)` |
| `h2` (Section) | `clamp(28px, 3.5vw, 46px)` |
| `h2` (CTA) | `clamp(28px, 4vw, 52px)` |
| `h3` (Card title) | `clamp(18px, 2vw, 24px)` – `clamp(22px, 2.8vw, 34px)` |
| Body / description | `text-[12px]` – `text-[13px]` |
| Labels / badges | `text-[9px]` – `text-[11px]` |

---

## 4. Layout & Spacing

### Page Structure

All sections are `min-h-screen` and centered with a shared max-width container:

```
<section class="... px-8 md:px-14 ...">
  <div class="max-w-[1100px] mx-auto w-full">
    ...
  </div>
</section>
```

> **Rule:** Always apply `px-8 md:px-14` at the **section** level. The inner `max-w-[1100px]` is the true content width.

### Section Label Pattern

Every section opens with a consistent label row:

```jsx
<div className="flex items-center gap-3 mb-14">
  <span className="font-mono text-[#333] text-[11px]">|—</span>
  <span className="font-mono text-[12px] tracking-[0.28em] uppercase text-[#333]">
    Section Name
  </span>
  <span className="flex-1 h-px bg-[#141414]" />
</div>
```

---

## 5. Component Patterns

### Cards

- `border border-[#141414]` — hairline border
- `bg-[#0d0d0d]` or `bg-[#111]` — slightly elevated surface
- No `border-radius` — hard square corners everywhere
- Optional: 4-corner `<span>` decorations using `border-t border-l` etc.

### CTA Buttons

**Primary:**
```
border border-white font-mono text-[10px] tracking-[0.22em] uppercase text-white
hover:bg-white hover:text-black transition-all duration-200
```

> **Rule:** Never use `border-radius`. Hover state is always white fill with `text-black` inversion.

---

## 6. Texture & Atmosphere

### Film Grain

Every section uses a subtle noise overlay:

```jsx
<div
  className="pointer-events-none absolute inset-0 opacity-25"
  style={{
    backgroundImage: `url("data:image/svg+xml,...")`,
    backgroundSize: '192px 192px',
  }}
/>
```

> This is the only "effect" in the design. No glows, blurs, or gradients.

---

## 7. What Not To Do

| ❌ Don't | ✅ Do instead |
|---|---|
| Use any color accent (blue, green, etc.) | Stay gray-scale |
| Use `border-radius` anywhere | Hard square corners only |
| Mix font families (e.g. Grotesk for labels) | Strict font role separation |
| Add box-shadows or drop-shadows | Use border + surface color for depth |

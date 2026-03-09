# RLD Landing — `demo.rld.fi`

New-design-system landing page for the RLD protocol. Lives at `demo.rld.fi`, served in parallel with the existing trading app at `rld.fi`.

## Stack

- React 18 + Vite + Tailwind CSS v3
- Pure marketing page — no Web3 dependencies
- All CTAs link to `rld.fi` app routes

## Local Dev

```bash
npm install
npm run dev          # runs on http://localhost:5174
```

## Deploy

```bash
bash deploy.sh
```

First-time SSL setup (after DNS A-record points to this server):

```bash
sudo certbot --nginx -d demo.rld.fi
```

## Design System

See [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) for full typography, color, spacing, and component rules.

## Sections

| File | Section |
|---|---|
| `src/Hero.jsx` | Full-screen hero — nav, tagline, 3-product body, CTAs |
| `src/UseCases.jsx` | Synthetic Bonds — Fixed Yield & Basis Trade cards |
| `src/SolvencyInsurance.jsx` | CDS — 4 risk cards + stats |
| `src/RatePerps.jsx` | Rate Perpetuals — SVG chart + 3 feature strips |
| `src/CoreArchitecture.jsx` | CTA footer + global footer |

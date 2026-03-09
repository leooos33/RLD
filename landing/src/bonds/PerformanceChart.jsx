import {
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts'

/* ── Compute projection data ──────────────────────────────────── */
function buildProjectionData(notional, ratePercent, maturityDays) {
  const steps = Math.min(Math.max(Math.round(maturityDays), 7), 365)
  const data = []
  for (let d = 0; d <= steps; d++) {
    const fixed    = notional + notional * (ratePercent / 100) * (d / 365)
    // variable: float rate simulation — simple sinusoidal drift around a mean
    const floatRate = ratePercent * (1 + 0.4 * Math.sin(d / 20) - 0.1 * (d / steps))
    const variable = notional + notional * (floatRate / 100) * (d / 365)
    data.push({ day: d, fixed, variable, label: `Day ${d}` })
  }
  return data
}

/* ── Custom tooltip ───────────────────────────────────────────── */
function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}
         className="p-3 font-mono text-[11px] z-50">
      <p className="text-[#444] mb-2 pb-1 border-b border-[#141414]">
        Day {payload[0]?.payload?.day}
      </p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-6 mb-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5" style={{ background: entry.color }} />
            <span className="text-[#555] capitalize">{entry.name}</span>
          </div>
          <span className="text-[#ccc]">
            ${Number(entry.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ══ PERFORMANCE CHART ══════════════════════════════════════════ */
export function PerformanceChart({ notional = 1000, apy = 0, maturityDays = 90 }) {
  const data = buildProjectionData(notional, apy, maturityDays)
  if (!data.length) return null

  const finalFixed    = data[data.length - 1].fixed
  const projectedGain = finalFixed - notional

  return (
    <div className="border border-[#141414] bg-[#0b0b0b] flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-3.5 border-b border-[#141414] flex items-center justify-between shrink-0">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">
            Expected Performance
          </span>
          <span className="font-mono text-[16px] leading-none text-white">
            ${finalFixed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span className="font-mono text-[11px] text-[#555]">at maturity</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[#555]">Yield</span>
          <span className="font-mono text-[16px] leading-none text-[#ccc]">
            +${projectedGain.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="px-6 pt-3 flex items-center gap-5 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-4 h-px bg-white" />
          <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#777]">Fixed</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-px border-t border-dashed border-[#3a3a3a]" />
          <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#777]">Variable (est.)</span>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 px-2 py-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradFixed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ffffff" stopOpacity={0.12} />
                <stop offset="95%" stopColor="#ffffff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradVar" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#555555" stopOpacity={0.08} />
                <stop offset="95%" stopColor="#555555" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#181818" vertical={false} />

            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickFormatter={d => `D${d}`}
              stroke="#777"
              fontSize={10}
              minTickGap={50}
            />

            <YAxis
              orientation="right"
              stroke="#777"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val, i) =>
                i === 0 ? '' : `$${Number(val).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
              }
              domain={['auto', 'auto']}
              width={60}
            />

            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: '#333', strokeDasharray: '4 4' }}
            />

            {/* Variable (dashed underneath) */}
            <Area
              type="monotone"
              dataKey="variable"
              name="Variable"
              stroke="#3a3a3a"
              strokeWidth={1}
              strokeDasharray="4 4"
              fill="url(#gradVar)"
              isAnimationActive={false}
            />

            {/* Fixed (solid on top) */}
            <Area
              type="monotone"
              dataKey="fixed"
              name="Fixed"
              stroke="#ffffff"
              strokeWidth={1.5}
              fill="url(#gradFixed)"
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

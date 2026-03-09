/**
 * Portfolio — placeholder
 * Route: /portfolio
 */
export default function Portfolio() {
  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-1.5 h-1.5 bg-[#333]" />
          <span className="font-mono text-[10px] tracking-[0.35em] uppercase text-[#333]">
            Portfolio
          </span>
          <div className="w-1.5 h-1.5 bg-[#333]" />
        </div>
        <h1 className="font-mono text-[11px] tracking-[0.4em] uppercase text-[#555]">
          Soon
        </h1>
      </div>
    </div>
  )
}

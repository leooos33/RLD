import React from "react";

export default function StatItem({ label, value, valueClassName }) {
  return (
    <div>
      <div className="text-sm text-gray-400 uppercase tracking-widest mb-1">
        {label}
      </div>
      <div
        className={`text-xl font-light font-mono tracking-tighter ${valueClassName || "text-white"}`}
      >
        {value}
      </div>
    </div>
  );
}

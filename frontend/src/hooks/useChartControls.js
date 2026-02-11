import { useState } from "react";
import { getPastDate, getToday } from "../utils/helpers";

/**
 * Shared chart controls hook for date range, resolution, and quick range selection.
 * Used by both App (Terminal) and Markets pages.
 *
 * @param {Object} options
 * @param {string} options.defaultRange - Label for the default quick range (e.g. "ALL", "1Y")
 * @param {number} options.defaultDays - Number of days for the default range (e.g. 9999, 365)
 * @param {string} options.defaultResolution - Default resolution (e.g. "1D")
 */
export function useChartControls({
  defaultRange = "ALL",
  defaultDays = 9999,
  defaultResolution = "1D",
} = {}) {
  const [tempStart, setTempStart] = useState(getPastDate(defaultDays));
  const [tempEnd, setTempEnd] = useState(getToday());
  const [appliedStart, setAppliedStart] = useState(getPastDate(defaultDays));
  const [appliedEnd, setAppliedEnd] = useState(getToday());
  const [activeRange, setActiveRange] = useState(defaultRange);
  const [resolution, setResolution] = useState(defaultResolution);

  const handleApplyDate = () => {
    setAppliedStart(tempStart);
    setAppliedEnd(tempEnd);
    setActiveRange("CUSTOM");
  };

  const handleQuickRange = (days, label) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);

    if (days <= 3) setResolution("1H");
    else if (days <= 14) setResolution("1H");
    else if (days <= 90) setResolution("4H");
    else setResolution("1D");

    const startStr = start.toISOString().split("T")[0];
    const endStr = end.toISOString().split("T")[0];

    setTempStart(startStr);
    setTempEnd(endStr);
    setAppliedStart(startStr);
    setAppliedEnd(endStr);
    setActiveRange(label);
  };

  return {
    // State
    tempStart,
    tempEnd,
    appliedStart,
    appliedEnd,
    activeRange,
    resolution,
    // Setters (for syncing date inputs with API data, etc.)
    setTempStart,
    setTempEnd,
    setActiveRange,
    setResolution,
    // Actions
    handleApplyDate,
    handleQuickRange,
  };
}

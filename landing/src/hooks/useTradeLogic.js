import { useState } from 'react'

function getNextEpoch() {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

function toDateTimeLocal(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`
}

function formatEpoch(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:00`
}

export function useTradeLogic() {
  const [notional, setNotional] = useState(1000)
  const [maturityHours, setMaturityHours] = useState(90 * 24)

  const start = getNextEpoch()
  const end = new Date(start.getTime() + maturityHours * 3600 * 1000)
  const epochs = {
    start,
    end,
    startDisplay: formatEpoch(start),
    endDisplay: formatEpoch(end),
    endDateTimeLocal: toDateTimeLocal(end),
  }

  const maturityDays = maturityHours / 24

  const handleDaysChange = (days) => setMaturityHours(Math.max(1, Math.min(8760, days * 24)))
  const handleEndDateChange = (str) => {
    const diffH = Math.round((new Date(str) - getNextEpoch()) / 3600000)
    setMaturityHours(Math.max(1, Math.min(8760, diffH)))
  }

  return {
    notional, setNotional,
    maturityHours, maturityDays,
    epochs,
    handleDaysChange,
    handleEndDateChange,
  }
}

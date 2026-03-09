import { createContext, useContext } from 'react'
import { useSimulation } from '../hooks/useSimulation'

const SimulationContext = createContext(null)

export function SimulationProvider({ children }) {
  const sim = useSimulation({ pollInterval: 5000 })
  return (
    <SimulationContext.Provider value={sim}>
      {children}
    </SimulationContext.Provider>
  )
}

export function useSim() {
  const ctx = useContext(SimulationContext)
  if (!ctx) throw new Error('useSim() must be inside <SimulationProvider>')
  return ctx
}

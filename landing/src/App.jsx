import { Routes, Route } from 'react-router-dom'
import Hero from './Hero'
import UseCases from './UseCases'
import SolvencyInsurance from './SolvencyInsurance'
import RatePerps from './RatePerps'
import CoreArchitecture from './CoreArchitecture'
import BondsPage from './bonds/BondsPage'
import BondMarketPage from './bonds/BondMarketPage'
import PoolsPage from './pools/PoolsPage'
import PoolMarketPage from './pools/PoolMarketPage'
import PerpsPage from './perps/PerpsPage'
import PerpsMarketPage from './perps/PerpsMarketPage'
import DataPage from './data/DataPage'
import StrategiesPage from './strategies/StrategiesPage'
import BasisTradePage from './strategies/BasisTradePage'

function LandingPage() {
  return (
    <div className="min-h-screen bg-[#080808]">
      <Hero />
      <UseCases />
      <SolvencyInsurance />
      <RatePerps />
      <CoreArchitecture />
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/"               element={<LandingPage />} />
      <Route path="/bonds"          element={<BondsPage />} />
      <Route path="/bonds/:marketId" element={<BondMarketPage />} />
      <Route path="/pools"          element={<PoolsPage />} />
      <Route path="/pools/:poolId"  element={<PoolMarketPage />} />
      <Route path="/perps"           element={<PerpsPage />} />
      <Route path="/perps/:marketId"  element={<PerpsMarketPage />} />
      <Route path="/data"            element={<DataPage />} />
      <Route path="/strategies"                  element={<StrategiesPage />} />
      <Route path="/strategies/basis-trade"      element={<BasisTradePage />} />
    </Routes>
  )
}

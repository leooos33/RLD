import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { SimulationProvider } from './context/SimulationContext'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SimulationProvider>
        <App />
      </SimulationProvider>
    </HashRouter>
  </React.StrictMode>
)

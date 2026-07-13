import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'

import Atributos from './pages/Atributos'
import BCG from './pages/BCG'
import Categorias from './pages/Categorias'
import Compras from './pages/Compras'
import Configuracion from './pages/Configuracion'
import CostosFijos from './pages/CostosFijos'
import Dashboard from './pages/Dashboard'
import Importar from './pages/Importar'
import Movimientos from './pages/Movimientos'
import OrdenesEcommerce from './pages/OrdenesEcommerce'
import Productos from './pages/Productos'
import SellThrough from './pages/SellThrough'

const links = [
  { to: '/', label: '📊 Panel de Control' },
  { to: '/movimientos', label: '💰 Caja' },
  { to: '/productos', label: '👗 Catálogo' },
  { to: '/compras', label: '📦 Compras' },
  { to: '/importar', label: '📥 Importar' },
  { to: '/categorias', label: '🗂️ Categorías' },
  { to: '/atributos', label: '🏷️ Atributos' },
  { to: '/costos-fijos', label: '🔧 Estructura Fija' },
  { to: '/bcg', label: '🎯 Análisis' },
  { to: '/sell-through', label: '📈 Stock' },
  { to: '/ordenes-ecommerce', label: '🛒 Órdenes E-commerce' },
  { to: '/configuracion', label: '⚙️ Configuración' },
]

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0b0f19] text-gray-100">
        <nav className="bg-[#111827] border-b border-gray-800 px-4 py-3 flex flex-wrap gap-2 sticky top-0 z-10">
          <span className="font-bold text-lg mr-4 self-center">FashBalance</span>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === '/'}
              className={({ isActive }) =>
                `px-3 py-2 rounded-lg text-sm font-medium transition ${
                  isActive ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <main className="p-4 md:p-6 max-w-7xl mx-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/movimientos" element={<Movimientos />} />
            <Route path="/productos" element={<Productos />} />
            <Route path="/compras" element={<Compras />} />
            <Route path="/importar" element={<Importar />} />
            <Route path="/categorias" element={<Categorias />} />
            <Route path="/atributos" element={<Atributos />} />
            <Route path="/costos-fijos" element={<CostosFijos />} />
            <Route path="/bcg" element={<BCG />} />
            <Route path="/sell-through" element={<SellThrough />} />
            <Route path="/ordenes-ecommerce" element={<OrdenesEcommerce />} />
            <Route path="/configuracion" element={<Configuracion />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App

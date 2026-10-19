import { Link, NavLink, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PendingQueue } from './PendingQueue'
import { ItemEditor } from './ItemEditor'
import { ReportsView } from './ReportsView'
import { IngestionDashboard } from './IngestionDashboard'

// A single admin nav tab. The current tab gets an amber pill so the curator
// always knows where they are. `end` pins the Pending tab (its path is the
// `/admin` index) so it isn't marked active on every child route.
function NavTab({ to, end, children }: { to: string; end?: boolean; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        'px-3 py-1.5 rounded-full text-sm font-medium transition-colors ' +
        (isActive
          ? 'bg-amber-100 text-amber-800'
          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100')
      }
    >
      {children}
    </NavLink>
  )
}

export function AdminApp() {
  return (
    // text-gray-900 pins admin to its light theme even when the map's dark
    // basemap has put `.dark` on the document root — `.dark body` sets a
    // near-white text color that admin (light-only, no dark: variants)
    // would otherwise inherit, leaving the header links light-on-light.
    <div className="min-h-dvh bg-gray-50 text-gray-900">
      <div className="max-w-6xl mx-auto p-6">
        <header className="flex items-center gap-1 mb-8 flex-wrap border-b pb-3">
          <Link to="/admin" className="font-semibold text-base mr-3">
            frolicmap admin
          </Link>
          <NavTab to="/admin" end>Pending</NavTab>
          <NavTab to="/admin/reports">Reports</NavTab>
          <NavTab to="/admin/ingestion">Ingestion</NavTab>
          <Link to="/" className="text-gray-500 hover:text-gray-700 ml-auto text-sm">
            View site →
          </Link>
        </header>
        <Routes>
          <Route index element={<PendingQueue />} />
          <Route path="items/:id" element={<ItemEditor />} />
          <Route path="reports" element={<ReportsView />} />
          <Route path="ingestion" element={<IngestionDashboard />} />
        </Routes>
      </div>
    </div>
  )
}

export default AdminApp

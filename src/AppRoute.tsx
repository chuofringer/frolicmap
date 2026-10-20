import { Navigate, useLocation } from 'react-router-dom'
import { App } from '@/App'
import { storedHomeTarget } from '@/hooks/useHomeMetroRedirect'

/**
 * The catch-all route. On the bare home page (`/`, `/zh/`) a stored city
 * choice becomes a router-level redirect, so a returning visitor goes straight
 * to their metro without a page load: the prerendered `/cities/{slug}` file's
 * crawler fallback is never shown, and the Bay map never mounts first.
 * Visitors with no stored choice get the map, and `useHomeMetroRedirect`
 * (inside `App`) asks the edge where they are.
 *
 * One element type for every path, so moving between `/` and `/cities/{slug}`
 * keeps `App` mounted instead of rebuilding it.
 */
export function AppRoute() {
  const { pathname, search, hash } = useLocation()
  // `pathname` here is already relative to the router basename, which is
  // exactly what `Navigate` wants back: the `/zh` prefix is re-added for us.
  const target = storedHomeTarget({ pathname, search, hash })
  if (target) return <Navigate replace to={target} />
  return <App />
}

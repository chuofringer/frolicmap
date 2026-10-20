import { lazy } from 'react'

// Code-split page components for the route table in main.tsx. Kept in their
// own module (not the entry file) so react-refresh/only-export-components is
// satisfied: the entry file defines no components and exports nothing.
export const TermsPage = lazy(() => import('@/components/Legal/TermsPage'))
export const PrivacyPage = lazy(() => import('@/components/Legal/PrivacyPage'))
export const CitiesPage = lazy(() => import('@/pages/CitiesPage'))

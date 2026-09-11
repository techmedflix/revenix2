import { Suspense } from 'react'
import DashboardClient from './DashboardClient'

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="page">Loading...</div>}>
      <DashboardClient />
    </Suspense>
  )
}

import { Suspense } from 'react'
import CostLedgerClient from './CostLedgerClient'

export default function CostLedgerPage() {
  return (
    <Suspense fallback={<div className="page">Loading...</div>}>
      <CostLedgerClient />
    </Suspense>
  )
}

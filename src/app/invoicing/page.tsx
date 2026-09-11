import { Suspense } from 'react'
import InvoicingClient from './InvoicingClient'

export default function InvoicingPage() {
  return (
    <Suspense fallback={<div className="page">Loading...</div>}>
      <InvoicingClient />
    </Suspense>
  )
}

import { Suspense } from 'react'
import OrderBookClient from './OrderBookClient'

export default function OrderBookPage() {
  return (
    <Suspense fallback={<div className="page">Loading...</div>}>
      <OrderBookClient />
    </Suspense>
  )
}

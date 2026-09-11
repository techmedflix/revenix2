import { Suspense } from 'react'
import PocsClient from './PocsClient'

export default function PocsPage() {
  return (
    <Suspense fallback={<div className="page">Loading...</div>}>
      <PocsClient />
    </Suspense>
  )
}

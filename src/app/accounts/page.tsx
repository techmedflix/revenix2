import { Suspense } from 'react'
import AccountsClient from './AccountsClient'

export default function AccountsPage() {
  return (
    <Suspense fallback={<div className="page">Loading...</div>}>
      <AccountsClient />
    </Suspense>
  )
}

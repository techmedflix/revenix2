'use client'

import { useEffect } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

const STATUS_MESSAGES: Record<string, string> = {
  pending: 'Your account is pending admin approval.',
  revoked: 'Your MedOS access has been revoked.',
}

const ERROR_MESSAGES: Record<string, string> = {
  domain: 'Only @medflix.app Google accounts are allowed.',
  email: 'A valid email was not returned by Google.',
  AccessDenied: 'Access denied. Please contact admin.',
}

export default function LoginPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const search = useSearchParams()

  useEffect(() => {
    if (status === 'authenticated' && session?.user?.status === 'approved') {
      router.push('/dashboard')
    }
  }, [status, session?.user?.status, router])

  const statusKey = search.get('status') || ''
  const errorKey = search.get('error') || ''

  return (
    <div style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: 20,
      background: 'radial-gradient(ellipse at 30% 20%, rgba(74,158,255,0.06) 0%, transparent 50%), var(--bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 380, textAlign: 'center' }}>
        {/* Logo mark */}
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'var(--primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 900, color: '#fff',
          margin: '0 auto 16px',
          boxShadow: '0 8px 24px rgba(74,158,255,0.35)',
        }}>M</div>

        <h1 style={{ margin: '0 0 4px', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}>
          MedOS
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 12, color: 'var(--text-faint)' }}>
          Medflix Operating System
        </p>

        {STATUS_MESSAGES[statusKey] && (
          <div style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 10,
            background: 'var(--amber-soft)', border: '1px solid rgba(245,166,35,0.25)',
            color: 'var(--amber)', fontSize: 12, fontWeight: 600,
          }}>
            {STATUS_MESSAGES[statusKey]}
          </div>
        )}

        {ERROR_MESSAGES[errorKey] && (
          <div style={{
            marginBottom: 14, padding: '10px 14px', borderRadius: 10,
            background: 'var(--red-soft)', border: '1px solid rgba(255,95,95,0.25)',
            color: 'var(--red)', fontSize: 12, fontWeight: 600,
          }}>
            {ERROR_MESSAGES[errorKey]}
          </div>
        )}

        <button
          className="button-primary"
          style={{ width: '100%', padding: '11px', fontSize: 13, fontWeight: 700, borderRadius: 10 }}
          disabled={status === 'loading'}
          onClick={() => signIn('google', { callbackUrl: '/dashboard' })}
        >
          Continue with Google
        </button>

        <p style={{ marginTop: 14, fontSize: 11, color: 'var(--text-faint)' }}>
          Login is restricted to @medflix.app users.
        </p>
      </div>
    </div>
  )
}

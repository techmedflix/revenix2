'use client'

import { SessionProvider } from 'next-auth/react'
import { ThemeProvider } from '@/lib/ThemeContext'
import { ToastProvider } from '@/lib/ToastContext'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <ToastProvider>
          {children}
        </ToastProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}

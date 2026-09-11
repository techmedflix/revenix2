import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import type { UserRole } from '@prisma/client'
import { prisma } from './prisma'
import { sendAccessRequestEmail } from './access-email'

const PRE_APPROVED: Record<string, UserRole> = {
  'chirag@medflix.app': 'admin',
  'rohan@medflix.app': 'admin',
}

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || ''
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    async signIn({ user }) {
      const email = normalizeEmail(user.email)
      if (!email) return '/login?error=email'

      if (!email.endsWith('@medflix.app')) {
        return '/login?error=domain'
      }

      const preRole = PRE_APPROVED[email]
      if (preRole) {
        await prisma.user.upsert({
          where: { email },
          update: {
            name: user.name || undefined,
            image: user.image || undefined,
            role: preRole,
            status: 'approved',
            approvedAt: new Date(),
          },
          create: {
            email,
            name: user.name,
            image: user.image,
            role: preRole,
            status: 'approved',
            approvedAt: new Date(),
          },
        })
        return true
      }

      const existing = await prisma.user.findUnique({ where: { email } })

      if (!existing) {
        await prisma.user.create({
          data: {
            email,
            name: user.name,
            image: user.image,
            status: 'pending',
          },
        })

        await sendAccessRequestEmail({
          requesterEmail: email,
          requesterName: user.name,
        })

        return '/login?status=pending'
      }

      if (existing.status === 'revoked') return '/login?status=revoked'
      if (existing.status === 'pending') return '/login?status=pending'

      await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: user.name || existing.name,
          image: user.image || existing.image,
        },
      })

      return true
    },
    async jwt({ token }) {
      const email = normalizeEmail(token.email)
      if (!email) return token

      const dbUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true, role: true, status: true, name: true, image: true },
      })

      if (dbUser) {
        token.id = dbUser.id
        token.role = dbUser.role
        token.status = dbUser.status
        token.name = dbUser.name || token.name
        token.picture = dbUser.image || token.picture
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) || ''
        session.user.role = (token.role as UserRole) || 'partnerships'
        session.user.status = (token.status as any) || 'pending'
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
}

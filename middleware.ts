import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

const OPEN_PREFIXES = ['/login', '/api/auth', '/_next', '/favicon.ico']

function matches(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (OPEN_PREFIXES.some((p) => matches(pathname, p))) {
    return NextResponse.next()
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })

  if (!token) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (token.status !== 'approved') {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Access not approved' }, { status: 403 })
    }
    const status = token.status === 'revoked' ? 'revoked' : 'pending'
    return NextResponse.redirect(new URL(`/login?status=${status}`, request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}

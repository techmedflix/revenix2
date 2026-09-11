'use client'

// Drop-in replacement for `fetch` used by the app's client pages to talk to
// our own /api routes. GET requests are cached in-memory for a short TTL and
// de-duplicated across concurrent callers, so switching between tabs (or
// mounting multiple components that read the same endpoint, e.g. /api/accounts)
// doesn't re-hit the network every time. Any non-GET request clears the cache
// on success so a page never shows stale data right after a write.

const DEFAULT_TTL_MS = 15_000

type CacheEntry = { data: unknown; expiresAt: number }

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

function isGet(init?: RequestInit) {
  return !init?.method || init.method.toUpperCase() === 'GET'
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!isGet(init)) {
    const res = await fetch(input, init)
    if (res.ok) {
      cache.clear()
      inflight.clear()
    }
    return res
  }

  const cached = cache.get(input)
  if (cached && cached.expiresAt > Date.now()) {
    return jsonResponse(cached.data)
  }

  let pending = inflight.get(input)
  if (!pending) {
    pending = fetch(input, init)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        cache.set(input, { data, expiresAt: Date.now() + DEFAULT_TTL_MS })
        return data
      })
      .finally(() => {
        inflight.delete(input)
      })
    inflight.set(input, pending)
  }

  try {
    const data = await pending
    return jsonResponse(data)
  } catch {
    // Something went wrong (bad status or network error) — don't cache it,
    // and let the caller see the real response/error instead of a synthetic one.
    return fetch(input, init)
  }
}

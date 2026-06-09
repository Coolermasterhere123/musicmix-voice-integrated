const CACHE = 'musicmix-v3'
const PRECACHE = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png']

// Install — cache shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

// Activate — delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Fetch — network first for API and YouTube, cache first for assets
self.addEventListener('fetch', e => {
  const url = e.request.url

  // Never cache: API calls, YouTube, external streams
  if (
    url.includes('/api/') ||
    url.includes('youtube.com') ||
    url.includes('ytimg.com') ||
    url.includes('googlevideo.com') ||
    url.includes('radio-browser') ||
    url.includes('soundcloud')
  ) {
    return // let browser handle normally
  }

  // Network first for navigation (always get fresh HTML)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => { caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r })
        .catch(() => caches.match(e.request))
    )
    return
  }

  // Cache first for static assets (JS, CSS, fonts, images)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()))
        return r
      })
    })
  )
})

// Keep service worker alive for background audio
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})

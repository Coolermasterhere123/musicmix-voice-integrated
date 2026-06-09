const CACHE = 'musicmix-v4'
const PRECACHE = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  const url = e.request.url

  // Never intercept: API, YouTube, external audio streams, radio
  if (
    url.includes('/api/') ||
    url.includes('youtube.com') ||
    url.includes('ytimg.com') ||
    url.includes('googlevideo.com') ||
    url.includes('radio-browser') ||
    url.includes('soundcloud') ||
    url.includes('ggpht.com')
  ) return

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => { caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r })
        .catch(() => caches.match('/'))
    )
    return
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(r => {
        if (r && r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()))
        return r
      })
    })
  )
})

// Keep SW alive — ping every 20s when audio is playing
// This prevents the browser from killing the SW on lock screen
let keepAliveInterval = null

self.addEventListener('message', e => {
  if (e.data === 'AUDIO_PLAYING') {
    if (!keepAliveInterval) {
      keepAliveInterval = setInterval(() => {
        self.clients.matchAll().then(clients => {
          clients.forEach(c => c.postMessage('SW_ALIVE'))
        })
      }, 20000)
    }
  }
  if (e.data === 'AUDIO_STOPPED') {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }
  if (e.data === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

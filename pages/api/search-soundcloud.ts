import type { NextApiRequest, NextApiResponse } from 'next'

// SoundCloud's public client ID — scraped from their web app
// This is the same approach SoundCloud embeds use
async function getSoundCloudClientId(): Promise<string> {
  try {
    const html = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' }
    }).then(r => r.text())

    // Find script URLs
    const scriptUrls = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
      .map(m => m[1])

    // Search scripts for client_id
    for (const url of scriptUrls.slice(-5)) {
      try {
        const js = await fetch(url).then(r => r.text())
        const match = js.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/)
        if (match) return match[1]
      } catch {}
    }
  } catch {}
  return ''
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const query = (req.query.q as string || '').trim()
  const mode  = (req.query.mode as string || 'song')
  if (!query) return res.status(200).json({ results: [] })

  try {
    const clientId = await getSoundCloudClientId()
    if (!clientId) return res.status(200).json({ results: [], error: 'Could not get client ID' })

    // Search SoundCloud
    const limit = 20
    const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}&limit=${limit}&client_id=${clientId}`

    const data = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
    }).then(r => r.json())

    const collection = data?.collection || []

    const results = collection.map((track: any) => {
      const durationSecs = Math.round((track.duration || 0) / 1000)
      const mm = String(Math.floor(durationSecs / 60)).padStart(1,'0')
      const ss = String(durationSecs % 60).padStart(2,'0')

      return {
        id:           String(track.id),
        title:        track.title || '',
        channel:      track.user?.username || '',
        artist:       track.user?.username || '',
        duration:     `${mm}:${ss}`,
        durationSecs,
        thumbnail:    track.artwork_url?.replace('large','t300x300') || track.user?.avatar_url || '',
        views:        track.playback_count ? `${(track.playback_count/1000).toFixed(0)}K plays` : '',
        viewCount:    track.playback_count || 0,
        permalinkUrl: track.permalink_url || '',
        streamable:   track.streamable,
        playlistId:   null,
        isMix:        false,
        score:        track.playback_count || 0,
        clientId,     // pass through so player can use it
      }
    })

    // Sort by play count (popularity) in artist mode
    if (mode === 'artist') {
      results.sort((a: any, b: any) => b.viewCount - a.viewCount)
    }

    return res.status(200).json({ results })

  } catch (e: any) {
    console.error('SoundCloud search error:', e?.message)
    return res.status(200).json({ results: [], error: 'Search failed' })
  }
}

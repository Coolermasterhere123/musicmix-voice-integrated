import type { NextApiRequest, NextApiResponse } from 'next'

function parseViews(text: string): number {
  if (!text) return 0
  const t = text.replace(/,/g, '').toLowerCase()
  const m = t.match(/([\d.]+)\s*([kmb])?/)
  if (!m) return 0
  const n = parseFloat(m[1])
  if (m[2] === 'b') return Math.round(n * 1_000_000_000)
  if (m[2] === 'm') return Math.round(n * 1_000_000)
  if (m[2] === 'k') return Math.round(n * 1_000)
  return Math.round(n)
}

async function scrapeYouTube(query: string): Promise<any[]> {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`
  const html = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
    }
  }).then(r => r.text())

  const marker = 'var ytInitialData = '
  const start = html.indexOf(marker)
  if (start === -1) return []

  let depth = 0, i = start + marker.length
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break } }
  }

  try {
    const data = JSON.parse(html.slice(start + marker.length, i))
    const sections = data?.contents?.twoColumnSearchResultsRenderer
      ?.primaryContents?.sectionListRenderer?.contents || []

    const items: any[] = []
    for (const section of sections) {
      const content = section?.itemSectionRenderer?.contents || []
      items.push(...content)
    }
    return items
  } catch { return [] }
}

function parseDuration(text: string): number {
  if (!text) return 0
  const parts = text.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const query = (req.query.q as string || '').trim()
  const mode  = (req.query.mode as string || 'song') // 'song' | 'artist'
  if (!query) return res.status(200).json({ results: [] })

  try {
    const items = await scrapeYouTube(query)
    const results: any[] = []

    for (const item of items) {
      const vr = item?.videoRenderer
      if (!vr?.videoId) continue
      if (results.length >= 20) break

      const title        = vr.title?.runs?.[0]?.text || ''
      const channel      = vr.ownerText?.runs?.[0]?.text || ''
      const duration     = vr.lengthText?.simpleText || ''
      const totalSecs    = parseDuration(duration)
      const viewText     = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || ''
      const viewCount    = parseViews(viewText)
      const playlistId   = vr.navigationEndpoint?.watchEndpoint?.playlistId || null
      const channelBadge = vr.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || ''

      const titleL   = title.toLowerCase()
      const channelL = channel.toLowerCase()
      const queryL   = query.toLowerCase()

      // Hard filter: skip obvious junk regardless of mode
      const isJunk =
        /karaoke|tribute band|reaction|review|tutorial|lesson|how to play|drum cover|bass cover|guitar cover|backing track/i.test(title)
      if (isJunk) continue

      // Hard filter: skip mixes / compilations
      const isMix =
        totalSecs > 1200 ||
        /\b(playlist|mix|compilation|greatest hits|best of|full album|top \d|collection|medley|all songs)\b/i.test(title)
      if (isMix) continue

      // Hard filter: skip playlists
      if (playlistId) continue

      // Hard filter: skip too short (clips/intros) or too long
      if (totalSecs > 0 && (totalSecs < 60 || totalSecs > 660)) continue

      // ── ARTIST MODE: only keep results where artist name appears in channel or title ──
      if (mode === 'artist') {
        const artistWords = queryL.replace(/official|audio|video|songs|music/gi, '')
          .trim().split(/\s+/).filter(w => w.length > 2)
        const matchesArtist = artistWords.some(w => channelL.includes(w) || titleL.includes(w))
        if (!matchesArtist) continue
      }

      // ── SCORING ──
      let score = 0

      // Channel match (strongest signal for both modes)
      if (channelL === queryL)                    score += 100
      else if (channelL.includes(queryL))         score += 70
      else if (queryL.split(' ').every((w:string) => channelL.includes(w))) score += 50

      // Title match
      if (titleL.includes(queryL))               score += 40

      // Official signals
      if (titleL.includes('official video'))      score += 30
      if (titleL.includes('official music video'))score += 28
      if (titleL.includes('official audio'))      score += 25
      if (titleL.includes('official'))            score += 12
      if (titleL.includes('remastered'))          score += 8
      if (titleL.includes('lyric'))               score += 5
      if (titleL.includes('audio'))               score += 4
      if (channelL.includes('vevo'))              score += 25
      if (channelBadge)                           score += 8

      // Cover penalty (lighter — covers can still be good)
      if (titleL.includes('cover'))               score -= 25
      if (titleL.includes('live'))                score -= 8
      if (titleL.includes('demo'))                score -= 10

      // Reasonable length bonus
      if (totalSecs >= 120 && totalSecs <= 420)   score += 10

      // View count — log scale bonus (0 to +30)
      // 1K=0, 100K=5, 1M=10, 10M=15, 100M=20, 500M=25, 1B=30
      if (viewCount > 1000) {
        score += Math.min(30, Math.round((Math.log10(viewCount) - 3) * 5))
      }

      results.push({
        id:          vr.videoId,
        title,
        channel,
        duration,
        durationSecs: totalSecs,
        thumbnail:   `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
        views:       viewText,
        viewCount,
        playlistId:  null,
        isMix:       false,
        score,
      })
    }

    // In artist mode sort purely by view count (popularity)
    // In song mode sort by relevance score
    if (mode === 'artist') {
      results.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
    } else {
      results.sort((a, b) => b.score - a.score)
    }

    return res.status(200).json({ results })

  } catch (e: any) {
    console.error('YouTube search error:', e?.message)
    return res.status(200).json({ results: [], error: 'Search failed' })
  }
}

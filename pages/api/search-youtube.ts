import type { NextApiRequest, NextApiResponse } from 'next'

// Parse view count strings like "1.2M views", "450K views", "12,345 views"
function parseViews(text: string): number {
  if (!text) return 0
  const t = text.replace(/,/g, '').toLowerCase()
  const m = t.match(/([\d.]+)\s*([kmb])?/)
  if (!m) return 0
  const n = parseFloat(m[1])
  if (m[2] === 'b') return n * 1_000_000_000
  if (m[2] === 'm') return n * 1_000_000
  if (m[2] === 'k') return n * 1_000
  return n
}

// Parse "Artist - Song" or "Song by Artist" for smarter scoring
function parseQuery(q: string) {
  const byMatch = q.match(/^(.+?)\s+by\s+(.+)$/i)
  if (byMatch) return { song: byMatch[1].trim(), artist: byMatch[2].trim() }
  const dashMatch = q.match(/^(.+?)\s*[-–]\s*(.+)$/)
  if (dashMatch) return { artist: dashMatch[1].trim(), song: dashMatch[2].trim() }
  return { song: q, artist: '' }
}

async function fetchYouTubeResults(query: string) {
  // EgIQAQ = videos only filter
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`
  const html = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml',
    }
  }).then(r => r.text())

  const marker = 'var ytInitialData = '
  const startIdx = html.indexOf(marker)
  if (startIdx === -1) return []

  let depth = 0, i = startIdx + marker.length
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break } }
  }

  const data = JSON.parse(html.slice(startIdx + marker.length, i))
  return data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
    ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const query = req.query.q as string
  const artistOnly = req.query.artistOnly === '1' // new flag: strict artist mode
  if (!query) return res.status(200).json({ results: [] })

  const parsed = parseQuery(query)
  // For artist-only mode, the query IS the artist name
  const artistName = artistOnly ? query : parsed.artist

  try {
    const contents = await fetchYouTubeResults(query)
    const results: any[] = []

    for (const item of contents) {
      const vr = item?.videoRenderer
      if (!vr) continue
      if (results.length >= 25) break

      const duration = vr.lengthText?.simpleText || ''
      const durationParts = duration.split(':')
      const totalSecs =
        durationParts.length === 3
          ? parseInt(durationParts[0]) * 3600 + parseInt(durationParts[1]) * 60 + parseInt(durationParts[2])
          : durationParts.length === 2
          ? parseInt(durationParts[0]) * 60 + parseInt(durationParts[1])
          : 0

      const title   = vr.title?.runs?.[0]?.text || ''
      const channel = vr.ownerText?.runs?.[0]?.text || ''
      const viewCountText = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || ''
      const viewCount = parseViews(viewCountText)
      const playlistId = vr.navigationEndpoint?.watchEndpoint?.playlistId || null

      const isMix =
        totalSecs > 1200 ||
        /playlist|mix|compilation|greatest hits|best of|full album|top songs|collection|medley/i.test(title)

      const isSensibleLength = totalSecs >= 90 && totalSecs <= 600

      const qLower       = query.toLowerCase().trim()
      const titleLower   = title.toLowerCase()
      const channelLower = channel.toLowerCase()
      const songLower    = parsed.song.toLowerCase()
      const artistLower  = artistName.toLowerCase()

      let score = 0

      // ── Artist match (most important in artist-only mode) ──────────────────
      if (artistLower) {
        // Channel name IS the artist — strongest signal
        if (channelLower === artistLower)                    score += 120
        else if (channelLower.includes(artistLower))         score += 80
        else if (channelLower.includes(artistLower.split(' ')[0])) score += 30

        // Artist name in title
        if (titleLower.includes(artistLower))                score += 50

        // HARD PENALTY: artist name not in title or channel at all in artist-only mode
        if (artistOnly) {
          const artistWords = artistLower.split(/\s+/).filter(w => w.length > 2)
          const anyArtistWordMatch = artistWords.some(w => titleLower.includes(w) || channelLower.includes(w))
          if (!anyArtistWordMatch) score -= 200  // completely irrelevant result
        }
      }

      // ── Song name match ────────────────────────────────────────────────────
      if (songLower && !artistOnly) {
        if (titleLower === qLower)               score += 200
        if (titleLower.includes(songLower))      score += 80
      }

      // ── Official indicators ────────────────────────────────────────────────
      if (titleLower.includes('official video'))       score += 25
      if (titleLower.includes('official music video')) score += 22
      if (titleLower.includes('official audio'))       score += 20
      if (titleLower.includes('official'))             score += 10
      if (titleLower.includes('remastered'))           score += 8
      if (titleLower.includes('audio'))                score += 5
      if (titleLower.includes('lyric'))                score += 3
      if (channelLower.includes('vevo'))               score += 20

      // ── View count score — logarithmic so 100M doesn't dwarf everything ──
      // Maps: 1K→0, 100K→5, 1M→10, 10M→15, 100M→20, 1B→25
      if (viewCount > 0) {
        score += Math.min(25, Math.floor(Math.log10(viewCount) * 5) - 10)
      }

      // ── Penalise junk ──────────────────────────────────────────────────────
      if (isMix)                                          score -= 150
      if (playlistId)                                     score -= 150
      if (totalSecs > 600)                                score -= 80
      if (totalSecs < 60 && totalSecs > 0)                score -= 50
      if (titleLower.includes('cover'))                   score -= 40
      if (titleLower.includes('karaoke'))                 score -= 80
      if (titleLower.includes('tribute'))                 score -= 60
      if (titleLower.includes('reaction'))                score -= 80
      if (titleLower.includes('review'))                  score -= 80
      if (titleLower.includes('tutorial'))                score -= 80
      if (titleLower.includes('lesson'))                  score -= 80
      if (titleLower.includes('how to'))                  score -= 80
      if (titleLower.includes('drum'))                    score -= 30
      if (titleLower.includes('bass'))                    score -= 20
      if (titleLower.includes('guitar'))                  score -= 20
      if (/vs\.?|versus/i.test(titleLower))               score -= 40
      if (isSensibleLength)                               score += 15

      results.push({
        id: vr.videoId,
        title,
        channel,
        duration,
        durationSecs: totalSecs,
        thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
        views: viewCountText,
        viewCount,
        playlistId,
        isMix,
        score,
      })
    }

    results.sort((a, b) => b.score - a.score)
    return res.status(200).json({ results })

  } catch (e: any) {
    console.error('YouTube search error:', e?.message)
    return res.status(200).json({ results: [], error: 'Search failed' })
  }
}

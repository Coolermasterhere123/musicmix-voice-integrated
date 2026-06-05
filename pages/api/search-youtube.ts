import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const query = req.query.q as string
  if (!query) return res.status(200).json({ results: [] })

  // Parse "Artist - Song" or "Song by Artist" patterns for smarter scoring
  const parseQuery = (q: string) => {
    const byMatch = q.match(/^(.+?)\s+by\s+(.+)$/i)
    if (byMatch) return { song: byMatch[1].trim(), artist: byMatch[2].trim() }
    const dashMatch = q.match(/^(.+?)\s*[-–]\s*(.+)$/)
    if (dashMatch) return { artist: dashMatch[1].trim(), song: dashMatch[2].trim() }
    return { song: q, artist: '' }
  }
  const parsed = parseQuery(query)

  try {
    // Use EgIQAQ filter = videos only (no playlists in results)
    const searchUrl =
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`

    const html = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml',
      }
    }).then(r => r.text())

    const marker = 'var ytInitialData = '
    const startIdx = html.indexOf(marker)
    if (startIdx === -1) return res.status(200).json({ results: [] })

    let depth = 0
    let i = startIdx + marker.length
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++
      else if (html[i] === '}') { depth--; if (depth === 0) { i++; break } }
    }

    const data = JSON.parse(html.slice(startIdx + marker.length, i))
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || []

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

      const title = vr.title?.runs?.[0]?.text || ''
      const channel = vr.ownerText?.runs?.[0]?.text || ''
      const verifiedBadge = vr.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || ''
      const viewCountText = vr.viewCountText?.simpleText || ''
      const viewCount = parseInt(viewCountText.replace(/[^0-9]/g, '')) || 0
      const playlistId = vr.navigationEndpoint?.watchEndpoint?.playlistId || null

      // ── Detect mixes / compilations / full albums ──
      const isMix =
        totalSecs > 1200 ||
        /playlist|mix|compilation|greatest hits|best of|full album|top songs|collection|medley/i.test(title)

      // ── Song length sanity check: most songs 1:30–8:00 ──
      const isSensibleLength = totalSecs >= 90 && totalSecs <= 600

      const qLower = query.toLowerCase().trim()
      const titleLower = title.toLowerCase()
      const channelLower = channel.toLowerCase()
      const songLower = parsed.song.toLowerCase()
      const artistLower = parsed.artist.toLowerCase()

      // ── Scoring ──
      let score = 0

      // Exact full query in title
      if (titleLower === qLower) score += 200

      // Song name match
      if (songLower && titleLower.includes(songLower)) score += 80
      // Artist name match in title or channel
      if (artistLower && titleLower.includes(artistLower)) score += 60
      if (artistLower && channelLower.includes(artistLower)) score += 40

      // Official indicators
      if (titleLower.includes('official video')) score += 25
      if (titleLower.includes('official audio')) score += 20
      if (titleLower.includes('official music video')) score += 22
      if (titleLower.includes('official')) score += 10
      if (titleLower.includes('audio')) score += 5
      if (titleLower.includes('remastered')) score += 5
      if (titleLower.includes('lyric')) score += 3

      // Verified / VEVO channel bonus
      if (channelLower.includes('vevo')) score += 20
      if (verifiedBadge) score += 5

      // Penalise wrong stuff hard
      if (isMix) score -= 150
      if (playlistId) score -= 150
      if (totalSecs > 600) score -= 80   // too long = likely a live set or compilation
      if (totalSecs < 60 && totalSecs > 0) score -= 50  // too short = clip/intro
      if (titleLower.includes('cover')) score -= 20
      if (titleLower.includes('karaoke')) score -= 50
      if (titleLower.includes('tribute')) score -= 30
      if (titleLower.includes('reaction')) score -= 60
      if (titleLower.includes('review')) score -= 60
      if (titleLower.includes('tutorial')) score -= 60
      if (titleLower.includes('lesson')) score -= 60
      if (titleLower.includes('how to')) score -= 60
      if (titleLower.includes('live at') || titleLower.includes('live from')) score -= 10

      // Reasonable length bonus
      if (isSensibleLength) score += 15

      // Individual word matches
      const queryWords = qLower.split(/\s+/)
      for (const word of queryWords) {
        if (word.length < 3) continue
        if (titleLower.includes(word)) score += 3
        if (channelLower.includes(word)) score += 2
      }

      results.push({
        id: vr.videoId,
        title,
        channel,
        duration,
        durationSecs: totalSecs,
        thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
        views: viewCountText,
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

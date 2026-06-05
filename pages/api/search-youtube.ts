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
    const contents = data?.contents?.twoColumnSearchResultsRenderer
      ?.primaryContents?.sectionListRenderer?.contents || []
    const items: any[] = []
    for (const section of contents) {
      const rows = section?.itemSectionRenderer?.contents || []
      items.push(...rows)
    }
    return items
  } catch { return [] }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const query = (req.query.q as string || '').trim()
  const mode  = (req.query.mode as string || 'song')
  if (!query) return res.status(200).json({ results: [] })

  try {
    const items = await scrapeYouTube(query)
    const results: any[] = []

    for (const item of items) {
      const vr = item?.videoRenderer
      if (!vr?.videoId) continue

      const title     = vr.title?.runs?.[0]?.text || ''
      const channel   = vr.ownerText?.runs?.[0]?.text || ''
      const duration  = vr.lengthText?.simpleText || ''
      const viewText  = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || ''
      const viewCount = parseViews(viewText)
      const playlistId = vr.navigationEndpoint?.watchEndpoint?.playlistId || null

      const durationParts = duration.split(':').map(Number)
      const totalSecs =
        durationParts.length === 3 ? durationParts[0]*3600 + durationParts[1]*60 + durationParts[2] :
        durationParts.length === 2 ? durationParts[0]*60 + durationParts[1] : 0

      const titleL   = title.toLowerCase()
      const channelL = channel.toLowerCase()

      // ── ONLY skip the absolute worst offenders ──
      if (playlistId) continue
      if (/karaoke|reaction\s+video|tutorial|how to play/i.test(title)) continue
      // Skip obvious full-album/mega-compilations (over 20 min)
      if (totalSecs > 1200) continue

      // ── ARTIST MODE: must mention artist somewhere ──
      if (mode === 'artist') {
        const artistWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
        const found = artistWords.some(w => titleL.includes(w) || channelL.includes(w))
        if (!found) continue
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
        isMix:       totalSecs > 1200,
        score:       viewCount,
      })
    }

    // Artist mode → sort by views (popularity). Song mode → keep YouTube's natural order
    if (mode === 'artist') {
      results.sort((a, b) => b.viewCount - a.viewCount)
    }

    return res.status(200).json({ results: results.slice(0, 20) })

  } catch (e: any) {
    console.error('YouTube search error:', e?.message)
    return res.status(200).json({ results: [], error: 'Search failed' })
  }
}

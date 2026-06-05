import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const query = req.query.q as string
  if (!query) return res.status(200).json({ results: [] })

  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`
    const html = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }).then(r => r.text())

    const marker = 'var ytInitialData = '
    const startIdx = html.indexOf(marker)
    if (startIdx === -1) return res.status(200).json({ results: [] })

    let depth = 0, i = startIdx + marker.length
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++
      else if (html[i] === '}') { depth--; if (depth === 0) { i++; break } }
    }
    const data = JSON.parse(html.slice(startIdx + marker.length, i))
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || []

    const results = []
    for (const item of contents) {
      const vr = item?.videoRenderer
      if (!vr) continue
      if (results.length >= 20) break

      const duration = vr.lengthText?.simpleText || ''
      const durationParts = duration.split(':')
      const totalSecs = durationParts.length === 3
        ? parseInt(durationParts[0]) * 3600 + parseInt(durationParts[1]) * 60 + parseInt(durationParts[2])
        : durationParts.length === 2
        ? parseInt(durationParts[0]) * 60 + parseInt(durationParts[1])
        : 0

      // Check if this video belongs to a playlist
      const playlistId = vr.navigationEndpoint?.watchEndpoint?.playlistId || null
      // Detect mix/compilation: long duration (>20min) or title has keywords
      const title = vr.title?.runs?.[0]?.text || ''
      const isMix = totalSecs > 1200 ||
        /playlist|mix|compilation|greatest hits|best of|full album|top songs|collection/i.test(title)

      results.push({
        id: vr.videoId,
        title,
        channel: vr.ownerText?.runs?.[0]?.text || '',
        duration,
        durationSecs: totalSecs,
        thumbnail: `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
        views: vr.viewCountText?.simpleText || '',
        playlistId,
        isMix,
      })
    }

    return res.status(200).json({ results })
  } catch (e: any) {
    console.error('YouTube search error:', e?.message)
    return res.status(200).json({ results: [], error: 'Search failed' })
  }
}

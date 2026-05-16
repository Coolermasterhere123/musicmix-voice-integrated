import type { NextApiRequest, NextApiResponse } from 'next'

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
  })
  return res.text()
}

function extractJson(html: string, marker: string): any | null {
  const startIdx = html.indexOf(marker)
  if (startIdx === -1) return null
  let depth = 0, i = startIdx + marker.length
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}') { depth--; if (depth === 0) { i++; break } }
  }
  try { return JSON.parse(html.slice(startIdx + marker.length, i)) } catch { return null }
}

function extractItems(data: any): any[] {
  // Path 1: playlist browse page
  const p1 = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]
    ?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
    ?.itemSectionRenderer?.contents?.[0]
    ?.playlistVideoListRenderer?.contents
  if (p1?.length) return p1

  // Path 2: watch page sidebar playlist panel
  const p2 = data?.contents?.twoColumnWatchNextResults?.playlist?.playlist?.contents
  if (p2?.length) return p2

  // Path 3: initial watch next results without playlist key
  const p3 = data?.contents?.twoColumnWatchNextResults?.secondaryResults
    ?.secondaryResults?.results
  if (p3?.length) return p3

  return []
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { listId, videoId } = req.query as { listId?: string; videoId?: string }
  if (!listId && !videoId) return res.status(400).json({ items: [] })

  const items: any[] = []
  const seen = new Set<string>()

  const addItem = (vid: string, title: string, channel: string, dur: string) => {
    if (!vid || !title || seen.has(vid)) return
    seen.add(vid)
    items.push({
      id: vid, youtubeId: vid, title, artist: channel, channel,
      thumbnail: `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
      duration: dur, source: 'youtube'
    })
  }

  const parseRows = (rows: any[]) => {
    for (const c of rows) {
      // playlist page format
      const pv = c?.playlistVideoRenderer
      if (pv) {
        addItem(
          pv.videoId,
          pv.title?.runs?.[0]?.text || pv.title?.simpleText || '',
          pv.shortBylineText?.runs?.[0]?.text || '',
          pv.lengthText?.simpleText || ''
        )
        continue
      }
      // watch page sidebar panel format
      const pp = c?.playlistPanelVideoRenderer
      if (pp) {
        addItem(
          pp.videoId,
          pp.title?.simpleText || pp.title?.runs?.[0]?.text || '',
          pp.longBylineText?.runs?.[0]?.text || pp.shortBylineText?.runs?.[0]?.text || '',
          pp.lengthText?.simpleText || ''
        )
      }
    }
  }

  try {
    // Try 1: playlist browse page (works for regular playlists)
    if (listId && !listId.startsWith('RD')) {
      const html = await fetchHtml(`https://www.youtube.com/playlist?list=${listId}`)
      const data = extractJson(html, 'var ytInitialData = ')
      if (data) parseRows(extractItems(data))
    }

    // Try 2: watch page with list param (works for mixes/radio and regular playlists)
    if (items.length < 3 && (videoId || listId)) {
      const watchUrl = videoId && listId
        ? `https://www.youtube.com/watch?v=${videoId}&list=${listId}`
        : videoId
        ? `https://www.youtube.com/watch?v=${videoId}`
        : `https://www.youtube.com/playlist?list=${listId}`
      const html = await fetchHtml(watchUrl)
      const data = extractJson(html, 'var ytInitialData = ')
      if (data) parseRows(extractItems(data))
    }

    // Try 3: RD mix — fetch via watch page
    if (items.length < 3 && listId?.startsWith('RD') && videoId) {
      const html = await fetchHtml(`https://www.youtube.com/watch?v=${videoId}&list=${listId}&start_radio=1`)
      const data = extractJson(html, 'var ytInitialData = ')
      if (data) parseRows(extractItems(data))
    }

    return res.status(200).json({ items, count: items.length })
  } catch (e: any) {
    console.error('yt-playlist error:', e?.message)
    return res.status(200).json({ items: [], error: e?.message })
  }
}

import type { NextApiRequest, NextApiResponse } from 'next'

async function getSoundCloudClientId(): Promise<string> {
  try {
    const html = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' }
    }).then(r => r.text())
    const scriptUrls = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1])
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
  const trackId  = (req.query.trackId as string || '').trim()
  const clientId = (req.query.clientId as string || '').trim()
  if (!trackId) return res.status(400).json({ error: 'trackId required' })

  try {
    const cid = clientId || await getSoundCloudClientId()
    if (!cid) return res.status(500).json({ error: 'No client ID' })

    // Get stream URL
    const streamData = await fetch(
      `https://api-v2.soundcloud.com/tracks/${trackId}/streams?client_id=${cid}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    ).then(r => r.json())

    const streamUrl =
      streamData?.http_mp3_128_url ||
      streamData?.preview_mp3_128_url ||
      null

    if (!streamUrl) return res.status(404).json({ error: 'No stream URL found' })

    return res.status(200).json({ streamUrl, clientId: cid })

  } catch (e: any) {
    console.error('sc-stream error:', e?.message)
    return res.status(500).json({ error: e?.message })
  }
}

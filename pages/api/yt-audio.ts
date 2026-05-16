import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { videoId } = req.query as { videoId: string }
  if (!videoId) return res.status(400).json({ error: 'videoId required' })

  try {
    const ytdl = await import('ytdl-core')

    const info = await ytdl.default.getInfo(`https://www.youtube.com/watch?v=${videoId}`, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }
      }
    })

    // Audio-only formats sorted by bitrate descending
    const audioFormats = info.formats
      .filter((f: any) => !f.hasVideo && f.hasAudio && f.url)
      .sort((a: any, b: any) => (b.audioBitrate || 0) - (a.audioBitrate || 0))

    if (!audioFormats.length) {
      return res.status(404).json({ error: 'No audio format found' })
    }

    const best = audioFormats[0] as any

    return res.status(200).json({
      audioUrl:  best.url,
      mimeType:  best.mimeType || 'audio/webm',
      bitrate:   best.audioBitrate,
      title:     info.videoDetails.title,
      author:    info.videoDetails.author.name,
      duration:  parseInt(info.videoDetails.lengthSeconds),
      thumbnail: info.videoDetails.thumbnails?.slice(-1)[0]?.url || null,
    })
  } catch (e: any) {
    console.error('yt-audio error:', e?.message)
    return res.status(500).json({ error: e?.message || 'Failed to get audio URL' })
  }
}

export const config = { api: { responseLimit: false } }

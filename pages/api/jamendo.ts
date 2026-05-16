import type { NextApiRequest, NextApiResponse } from 'next'

const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || 'b6747d04'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const query = (req.query.q as string) || ''
  const tags = (req.query.tags as string) || ''
  const type = (req.query.type as string) || 'tracks'
  const offset = parseInt((req.query.offset as string) || '0')
  const limit = parseInt((req.query.limit as string) || '50')

  const params = new URLSearchParams({
    client_id: JAMENDO_CLIENT_ID,
    format: 'json',
    limit: String(Math.min(limit, 200)),
    offset: String(offset),
    include: 'musicinfo',
    audioformat: 'mp32',
  })

  if (type === 'genre') {
    params.set('tags', query)
    params.set('order', 'popularity_total')
  } else {
    if (query) params.set('search', query)
    if (tags) params.set('tags', tags)
  }

  try {
    const response = await fetch(`https://api.jamendo.com/v3.0/tracks/?${params}`)
    const data = await response.json()
    const tracks = (data.results || []).map((t: any) => ({
      id: `jamendo_${t.id}`,
      title: t.name,
      artist: t.artist_name,
      album: t.album_name,
      duration: t.duration,
      audioUrl: t.audio,
      thumbnail: t.album_image || t.image,
      source: 'jamendo',
      tags: t.musicinfo?.tags?.genres || [],
    }))
    return res.status(200).json({ tracks, total: data.headers?.results_count || tracks.length })
  } catch (e: any) {
    console.error('Jamendo error:', e?.message || e)
    return res.status(200).json({ tracks: [], error: 'Jamendo fetch failed' })
  }
}

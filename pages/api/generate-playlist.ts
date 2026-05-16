import type { NextApiRequest, NextApiResponse } from 'next'
import Groq from 'groq-sdk'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY not set in Vercel environment variables', songs: [] })
  }

  const { genre, mood, count = 20, existingSongs = [] } = req.body

  const existingList = existingSongs.length > 0
    ? `Already suggested (do NOT repeat these): ${existingSongs.join(', ')}.`
    : ''

  const prompt = `You are a music expert DJ. Generate exactly ${count} real songs for genre: "${genre}"${mood ? ` with mood: "${mood}"` : ''}.
${existingList}

Return ONLY a valid JSON array, no markdown, no explanation, no backticks. Example:
[{"title":"Bohemian Rhapsody","artist":"Queen","year":1975},{"title":"Stairway to Heaven","artist":"Led Zeppelin","year":1971}]

Rules:
- Only real songs that actually exist
- Mix classic and modern tracks  
- Include both well-known and deeper cuts
- Vary tempo and feel within the genre
- No repeats from excluded list`

  try {
    const groq = new Groq({ apiKey })
    const completion = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens: 2000,
    })

    const text = completion.choices[0]?.message?.content || '[]'
    const cleaned = text.replace(/```json|```/g, '').trim()

    let songs = []
    try {
      songs = JSON.parse(cleaned)
    } catch {
      const match = cleaned.match(/\[[\s\S]*\]/)
      if (match) songs = JSON.parse(match[0])
    }

    return res.status(200).json({ songs })
  } catch (err: any) {
    console.error('Groq error:', err?.message || err)
    return res.status(500).json({ error: err?.message || 'Groq call failed', songs: [] })
  }
}

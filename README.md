# SoundWave 🎵

AI-powered music player with YouTube + Jamendo streaming.

## Features
- 🎸 Browse 10 genres with AI-generated infinite playlists (Groq/Llama3)
- 🔍 Search YouTube & Jamendo simultaneously
- 📋 Full queue management (add, remove, reorder)
- 🔀 Shuffle & repeat modes
- 📱 Wake Lock — keeps your Android screen on while playing
- ▶ YouTube audio playback via embedded iframe
- 🎵 Jamendo direct audio (free/legal music, no ads)

## Environment Variables
- `GROQ_API_KEY` — for AI playlist generation (already set on your system)
- `JAMENDO_CLIENT_ID` — optional, defaults to public demo key (`b6747d04`)

## Playlist Modes
- **Infinite stream**: Groq generates songs → searches YouTube+Jamendo for each
- **Load More**: Keeps expanding queue without repeating suggestions
- **Size control**: Choose 10 / 20 / 30 / 50 songs per generation
- **Source filter**: Filter visible tracks by YouTube or Jamendo

## Wake Lock (Android)
Uses the Web Screen Wake Lock API. Works in Chrome on Android when:
- The page is in the foreground
- User has interacted with the page (tap to play first)

## Architecture
- Next.js 14 (Pages router)
- Groq SDK (llama3-70b) for AI playlist generation
- YouTube: scrapes search results, plays via embedded iframe
- Jamendo: free/legal music with direct MP3 streaming

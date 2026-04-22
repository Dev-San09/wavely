# Wavely — Free Music Streaming

A free, open-source music streaming app with YouTube Music-quality recommendations, liquid glass UI, and zero API keys required.

## Quick Start

```bash
pip install -r requirements.txt
python app.py
# Open http://localhost:5000
```

## Production Deployment

```bash
pip install -r requirements.txt
gunicorn -w 4 -b 0.0.0.0:5000 wsgi:app
```

## Features

- YouTube Music search and recommendations via `ytmusicapi`
- Audio streaming via `yt-dlp` with proxy for instant playback
- Onboarding: pick languages and artists to personalize
- Explore: mood/genre playlists based on preferences
- Queue system: Play Next, Add to Queue, auto-recommendations
- Now Playing page with seek bar and Up Next
- Playlists: create, save, delete
- Liked songs with heart toggle
- 3-dot context menu on every track
- Keyboard shortcuts (Space, arrows, M, /)
- PWA installable on mobile
- Liquid glass UI with dark theme
- Responsive design for mobile and desktop

## Tech Stack

- **Backend**: Flask + ytmusicapi + yt-dlp
- **Frontend**: Vanilla JS + CSS (no framework)
- **Storage**: JSON files in `data/` directory
- **Audio**: Streaming proxy through Flask

## License

MIT

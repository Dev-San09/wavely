"""
Wavely - Free Open Source Music Streaming Application
Source: YouTube via yt-dlp + ytmusicapi
License: MIT
"""

import json
import logging
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import requests as http_req
from flask import Flask, render_template, request, jsonify, Response
from ytmusicapi import YTMusic, OAuthCredentials

# â”€â”€ Logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("wavely")

# â”€â”€ App Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024  # 1MB max request size

PORT = int(os.environ.get("PORT", 5000))
DEBUG = os.environ.get("FLASK_DEBUG", "0") == "1"

executor = ThreadPoolExecutor(max_workers=4)
_file_lock = threading.Lock()  # Thread-safe file operations

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
COOKIES_FILE = os.path.join(BASE_DIR, "cookies.txt")

def _ytdlp_cmd(args):
    """Build yt-dlp command with cookies and extractor args."""
    cmd = ["yt-dlp"] + args + ["--extractor-args", "youtube:player_client=web_creator,default"]
    if os.path.exists(COOKIES_FILE):
        cmd += ["--cookies", COOKIES_FILE]
        log.info(f"[YTDLP] Using cookies from {COOKIES_FILE}")
    else:
        log.warning(f"[YTDLP] No cookies file at {COOKIES_FILE}")
    return cmd


os.makedirs(DATA_DIR, exist_ok=True)

OAUTH_FILE = os.path.join(DATA_DIR, "oauth.json")
OAUTH_CREDS_FILE = os.path.join(DATA_DIR, "oauth_creds.json")
BROWSER_AUTH_FILE = os.path.join(DATA_DIR, "browser.json")
HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
LIKES_FILE = os.path.join(DATA_DIR, "likes.json")
PLAYLISTS_FILE = os.path.join(DATA_DIR, "playlists.json")

# Migrate old data files to data/ directory
for fname in ["oauth.json", "oauth_creds.json", "browser.json", "history.json", "likes.json", "playlists.json"]:
    old_path = os.path.join(BASE_DIR, fname)
    new_path = os.path.join(DATA_DIR, fname)
    if os.path.exists(old_path) and not os.path.exists(new_path):
        os.rename(old_path, new_path)
        log.info(f"Migrated {fname} to data/")


def load_oauth_creds():
    """Load client_id and client_secret from file."""
    if os.path.exists(OAUTH_CREDS_FILE):
        with open(OAUTH_CREDS_FILE, "r") as f:
            return json.load(f)
    return {}


def init_ytmusic():
    """Initialize YTMusic â€” try OAuth first, then browser auth, then anonymous."""
    creds = load_oauth_creds()
    client_id = creds.get("client_id", "")
    client_secret = creds.get("client_secret", "")

    # Try OAuth
    if os.path.exists(OAUTH_FILE) and client_id and client_secret:
        # Check file is not empty
        try:
            with open(OAUTH_FILE, "r") as f:
                content = f.read().strip()
            if not content or content == "{}":
                log.info("[AUTH] oauth.json is empty, skipping")
                os.remove(OAUTH_FILE)
            else:
                yt = YTMusic(OAUTH_FILE, oauth_credentials=OAuthCredentials(
                    client_id=client_id, client_secret=client_secret
                ))
                yt.get_home()
                log.info("[AUTH] âœ… Authenticated via OAuth (personalized recommendations)")
                return yt
        except Exception as e:
            log.info(f"[AUTH] âŒ OAuth failed or expired: {e}")
            log.info("[AUTH] Falling back to anonymous mode")

    # Try browser auth
    if os.path.exists(BROWSER_AUTH_FILE):
        try:
            yt = YTMusic(BROWSER_AUTH_FILE)
            yt.search("test", filter="songs", limit=1)
            log.info("[AUTH] âœ… Authenticated via browser cookies")
            return yt
        except Exception as e:
            log.info(f"[AUTH] âŒ Browser auth failed: {e}")

    log.info("[AUTH] Running anonymous (generic recommendations)")
    return YTMusic()


ytmusic = init_ytmusic()


def _get_working_ytmusic():
    """Return the global ytmusic instance."""
    return ytmusic

# Caches â€” cleared on every server restart
_recs_cache = {}
_stream_cache = {}
_audio_urls = {}
CACHE_MAX = 100
log.info("[CACHE] All caches cleared on startup")


def _validate_video_id(video_id):
    """Validate YouTube video ID format."""
    return bool(re.match(r'^[a-zA-Z0-9_-]{11}$', video_id))


def _evict_audio_cache():
    """Evict oldest entry from _audio_urls if over limit."""
    if len(_audio_urls) >= CACHE_MAX:
        _audio_urls.pop(next(iter(_audio_urls)))


# â”€â”€ Listening History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_history():
    """Load listening history from disk."""
    with _file_lock:
        try:
            if os.path.exists(HISTORY_FILE):
                with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
    return {"played": [], "searches": [], "artists": {}, "genres": {}}


def save_history(history):
    """Persist history to disk."""
    with _file_lock:
        try:
            with open(HISTORY_FILE, "w", encoding="utf-8") as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
        except Exception:
            pass


@app.route("/api/history/played", methods=["POST"])
def record_play():
    """Record a played track into history."""
    data = request.get_json(silent=True)
    if not data or not data.get("youtube_id"):
        return jsonify({"ok": False}), 400

    history = load_history()

    # Add to played list (keep last 200)
    entry = {
        "youtube_id": data["youtube_id"],
        "title": data.get("title", ""),
        "artist": data.get("artist", ""),
        "image": data.get("image", ""),
        "duration": data.get("duration", 0),
        "timestamp": int(time.time()),
    }

    # Remove duplicate if exists, then prepend
    history["played"] = [
        p for p in history["played"] if p["youtube_id"] != entry["youtube_id"]
    ]
    history["played"].insert(0, entry)
    history["played"] = history["played"][:200]

    # Track artist frequency
    artist = data.get("artist", "").strip()
    if artist:
        history["artists"][artist] = history["artists"].get(artist, 0) + 1

    save_history(history)
    return jsonify({"ok": True})


@app.route("/api/history/search", methods=["POST"])
def record_search():
    """Record a search query into history."""
    data = request.get_json(silent=True)
    if not data or not data.get("query"):
        return jsonify({"ok": False}), 400

    history = load_history()
    query = data["query"].strip()

    # Remove duplicate, prepend
    history["searches"] = [s for s in history["searches"] if s != query]
    history["searches"].insert(0, query)
    history["searches"] = history["searches"][:50]

    save_history(history)
    return jsonify({"ok": True})


@app.route("/api/history/recent")
def recent_history():
    """Get recently played tracks."""
    history = load_history()
    played = history.get("played", [])[:20]
    # Convert to standard track format
    tracks = []
    for p in played:
        tracks.append({
            "id": p["youtube_id"],
            "title": p.get("title", "Unknown"),
            "artist": p.get("artist", "Unknown"),
            "album": "",
            "image": p.get("image", ""),
            "duration": p.get("duration", 0),
            "source": "youtube",
            "stream_url": None,
            "youtube_id": p["youtube_id"],
        })
    return jsonify({"results": tracks})


# â”€â”€ Auth Setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

# Pending OAuth device flow state
_oauth_pending = {}


@app.route("/api/auth/status")
def auth_status():
    """Check authentication status."""
    creds = load_oauth_creds()
    has_oauth = os.path.exists(OAUTH_FILE) and creds.get("client_id")
    has_browser = os.path.exists(BROWSER_AUTH_FILE)
    method = "oauth" if has_oauth else "browser" if has_browser else "none"
    return jsonify({
        "authenticated": has_oauth or has_browser,
        "method": method,
        "has_client_creds": bool(creds.get("client_id")),
    })


@app.route("/api/auth/save-creds", methods=["POST"])
def save_client_creds():
    """Save OAuth client_id and client_secret."""
    data = request.get_json(silent=True)
    if not data or not data.get("client_id") or not data.get("client_secret"):
        return jsonify({"error": "client_id and client_secret required"}), 400
    with open(OAUTH_CREDS_FILE, "w") as f:
        json.dump({"client_id": data["client_id"], "client_secret": data["client_secret"]}, f)
    log.info(f"[AUTH] âœ… OAuth credentials saved")
    return jsonify({"ok": True})


@app.route("/api/auth/oauth-start", methods=["POST"])
def oauth_start():
    """Start OAuth using a fresh device code flow every time."""
    global _oauth_pending
    _oauth_pending = {}  # Clear any old pending flow

    # Remove old token if exists
    if os.path.exists(OAUTH_FILE):
        os.remove(OAUTH_FILE)

    creds = load_oauth_creds()
    client_id = creds.get("client_id", "")
    client_secret = creds.get("client_secret", "")
    if not client_id or not client_secret:
        return jsonify({"error": "Save client credentials first"}), 400

    try:
        # Use Google's device code endpoint directly
        resp = http_req.post("https://oauth2.googleapis.com/device/code", data={
            "client_id": client_id,
            "scope": "https://www.googleapis.com/auth/youtube",
        })
        data = resp.json()
        if "error" in data:
            return jsonify({"error": data.get("error_description", data["error"])}), 400

        _oauth_pending = {
            "device_code": data["device_code"],
            "user_code": data["user_code"],
            "verification_url": data["verification_url"],
            "client_id": client_id,
            "client_secret": client_secret,
        }

        return jsonify({
            "user_code": data["user_code"],
            "verification_url": data["verification_url"],
            "expires_in": data.get("expires_in", 1800),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/auth/oauth-poll", methods=["POST"])
def oauth_poll():
    """Poll Google to check if user completed sign-in, then use ytmusicapi to save token."""
    global ytmusic, _oauth_pending
    if not _oauth_pending:
        return jsonify({"error": "No pending OAuth flow"}), 400

    try:
        resp = http_req.post("https://oauth2.googleapis.com/token", data={
            "client_id": _oauth_pending["client_id"],
            "client_secret": _oauth_pending["client_secret"],
            "device_code": _oauth_pending["device_code"],
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        })
        data = resp.json()

        if "error" in data:
            if data["error"] == "authorization_pending":
                return jsonify({"status": "pending"})
            elif data["error"] == "slow_down":
                return jsonify({"status": "pending", "slow_down": True})
            else:
                _oauth_pending = {}
                return jsonify({"status": "error", "error": data.get("error_description", data["error"])})

        # Success â€” use ytmusicapi's own setup_oauth to create the token file properly
        from ytmusicapi import setup_oauth
        try:
            token = setup_oauth(
                client_id=_oauth_pending["client_id"],
                client_secret=_oauth_pending["client_secret"],
                filepath=OAUTH_FILE,
                open_browser=False,
            )
            # setup_oauth is interactive â€” it won't work here.
            # Instead, save the token in ytmusicapi's expected format
            raise Exception("Use manual save")
        except Exception:
            # Save token manually in the format ytmusicapi expects
            token_data = {
                "access_token": data["access_token"],
                "refresh_token": data["refresh_token"],
                "scope": data.get("scope", "https://www.googleapis.com/auth/youtube"),
                "token_type": data.get("token_type", "Bearer"),
                "expires_at": int(time.time()) + data.get("expires_in", 3600),
                "expires_in": data.get("expires_in", 3600),
            }
            with open(OAUTH_FILE, "w") as f:
                json.dump(token_data, f, indent=2)

        # Reinitialize YTMusic â€” try without the test call first
        try:
            ytmusic = YTMusic(OAUTH_FILE, oauth_credentials=OAuthCredentials(
                client_id=_oauth_pending["client_id"],
                client_secret=_oauth_pending["client_secret"],
            ))
            log.info("[AUTH] âœ… OAuth complete!")
        except Exception as e:
            log.info(f"[AUTH] âš ï¸ OAuth init warning: {e}")
            # Fall back to anonymous but keep the token for future attempts
            ytmusic = YTMusic()

        _recs_cache.clear()
        _stream_cache.clear()
        _oauth_pending = {}

        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    """Remove all authentication."""
    global ytmusic
    for f in [OAUTH_FILE, BROWSER_AUTH_FILE]:
        if os.path.exists(f):
            os.remove(f)
    ytmusic = YTMusic()
    _recs_cache.clear()
    _stream_cache.clear()
    log.info("[AUTH] Logged out")
    return jsonify({"ok": True})


# â”€â”€ Likes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def load_likes():
    with _file_lock:
        try:
            if os.path.exists(LIKES_FILE):
                with open(LIKES_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
    return []


def save_likes(likes):
    with _file_lock:
        with open(LIKES_FILE, "w", encoding="utf-8") as f:
            json.dump(likes, f, ensure_ascii=False, indent=2)


@app.route("/api/likes", methods=["GET"])
def get_likes():
    return jsonify({"tracks": load_likes()})


@app.route("/api/likes", methods=["POST"])
def toggle_like():
    data = request.get_json(silent=True)
    if not data or not data.get("youtube_id"):
        return jsonify({"error": "youtube_id required"}), 400
    likes = load_likes()
    yt_id = data["youtube_id"]
    existing = [l for l in likes if l.get("youtube_id") == yt_id]
    if existing:
        likes = [l for l in likes if l.get("youtube_id") != yt_id]
        save_likes(likes)
        return jsonify({"liked": False})
    else:
        likes.insert(0, {
            "youtube_id": yt_id,
            "title": data.get("title", ""),
            "artist": data.get("artist", ""),
            "image": data.get("image", ""),
            "duration": data.get("duration", 0),
            "timestamp": int(time.time()),
        })
        save_likes(likes)
        return jsonify({"liked": True})


@app.route("/api/likes/check/<yt_id>")
def check_like(yt_id):
    likes = load_likes()
    is_liked = any(l.get("youtube_id") == yt_id for l in likes)
    return jsonify({"liked": is_liked})


@app.route("/api/likes/check-batch", methods=["POST"])
def check_likes_batch():
    """Check like status for multiple IDs at once."""
    data = request.get_json(silent=True)
    if not data or not data.get("ids"):
        return jsonify({"results": {}})
    likes = load_likes()
    liked_ids = {l.get("youtube_id") for l in likes}
    results = {yt_id: yt_id in liked_ids for yt_id in data["ids"]}
    return jsonify({"results": results})


# â”€â”€ Playlists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


def load_playlists():
    with _file_lock:
        try:
            if os.path.exists(PLAYLISTS_FILE):
                with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
    return []


def save_playlists(playlists):
    with _file_lock:
        with open(PLAYLISTS_FILE, "w", encoding="utf-8") as f:
            json.dump(playlists, f, ensure_ascii=False, indent=2)


@app.route("/api/playlists", methods=["GET"])
def get_playlists():
    return jsonify({"playlists": load_playlists()})


@app.route("/api/playlists", methods=["POST"])
def create_playlist():
    data = request.get_json(silent=True)
    if not data or not data.get("name"):
        return jsonify({"error": "Name required"}), 400
    playlists = load_playlists()
    pl = {
        "id": str(int(time.time() * 1000)),
        "name": data["name"],
        "tracks": [],
        "created": int(time.time()),
    }
    playlists.append(pl)
    save_playlists(playlists)
    return jsonify({"ok": True, "playlist": pl})


@app.route("/api/playlists/<pl_id>", methods=["DELETE"])
def delete_playlist(pl_id):
    playlists = load_playlists()
    playlists = [p for p in playlists if p["id"] != pl_id]
    save_playlists(playlists)
    return jsonify({"ok": True})


@app.route("/api/playlists/<pl_id>/tracks", methods=["POST"])
def add_to_playlist(pl_id):
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Track data required"}), 400
    playlists = load_playlists()
    for pl in playlists:
        if pl["id"] == pl_id:
            # Don't add duplicates
            existing_ids = {t.get("youtube_id") for t in pl["tracks"]}
            if data.get("youtube_id") not in existing_ids:
                pl["tracks"].append({
                    "youtube_id": data.get("youtube_id", ""),
                    "title": data.get("title", "Unknown"),
                    "artist": data.get("artist", "Unknown"),
                    "image": data.get("image", ""),
                    "duration": data.get("duration", 0),
                })
            save_playlists(playlists)
            return jsonify({"ok": True})
    return jsonify({"error": "Playlist not found"}), 404


@app.route("/api/playlists/<pl_id>/tracks/<yt_id>", methods=["DELETE"])
def remove_from_playlist(pl_id, yt_id):
    playlists = load_playlists()
    for pl in playlists:
        if pl["id"] == pl_id:
            pl["tracks"] = [t for t in pl["tracks"] if t.get("youtube_id") != yt_id]
            save_playlists(playlists)
            return jsonify({"ok": True})
    return jsonify({"error": "Playlist not found"}), 404


# â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

# ── Error Handlers ───────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def server_error(e):
    log.error(f"Server error: {e}")
    return jsonify({"error": "Internal server error"}), 500

@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "version": "1.0.0"})


# ── User Preferences ────────────────────────────────────────────────────

PREFS_FILE = os.path.join(DATA_DIR, "preferences.json")

def load_prefs():
    try:
        if os.path.exists(PREFS_FILE):
            with open(PREFS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return None

def save_prefs(prefs):
    with _file_lock:
        with open(PREFS_FILE, "w", encoding="utf-8") as f:
            json.dump(prefs, f, ensure_ascii=False, indent=2)

@app.route("/api/preferences", methods=["GET"])
def get_preferences():
    prefs = load_prefs()
    return jsonify({"preferences": prefs})

@app.route("/api/preferences", methods=["POST"])
def set_preferences():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400
    prefs = {
        "languages": data.get("languages", []),
        "artists": data.get("artists", []),
        "setup_done": True,
    }
    save_prefs(prefs)
    # Clear home cache so it rebuilds with new preferences
    _home_cache["data"] = None
    log.info(f"[PREFS] Saved: {len(prefs['languages'])} languages, {len(prefs['artists'])} artists")
    return jsonify({"ok": True})

@app.route("/api/preferences/artists/search")
def search_artists():
    """Search for artists to add to preferences."""
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"artists": []})
    yt = _get_working_ytmusic()
    try:
        results = yt.search(query, filter="artists", limit=8)
        artists = []
        for a in results:
            thumbs = a.get("thumbnails", [])
            artists.append({
                "name": a.get("artist", a.get("title", "")),
                "id": a.get("browseId", ""),
                "image": thumbs[-1].get("url", "") if thumbs else "",
                "subscribers": a.get("subscribers", ""),
            })
        return jsonify({"artists": artists})
    except Exception as e:
        log.error(f"[PREFS] Artist search failed: {e}")
        return jsonify({"artists": []})


# ── Routes ──────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/search")
def search():
    """Search YouTube Music first, fallback to regular YouTube."""
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"source": None, "results": []})

    # Try YouTube Music search first (gives proper music results)
    results = search_ytmusic(query)
    if results:
        log.info(f"[SEARCH] âœ… ytmusicapi returned {len(results)} results for '{query}'")
        return jsonify({"source": "youtube", "results": results})

    # Fallback to yt-dlp regular YouTube search
    log.info(f"[SEARCH] ytmusicapi returned nothing, falling back to yt-dlp")
    results = search_youtube(query)
    if results:
        return jsonify({"source": "youtube", "results": results})
    return jsonify({"source": None, "results": []})


@app.route("/api/trending")
def trending():
    """Get trending/popular music from YouTube Music."""
    genre = request.args.get("genre", "")
    lang = request.args.get("lang", "")
    query = lang or f"{genre} music" if genre else "trending music 2025"
    results = search_ytmusic(query)
    if not results:
        results = search_youtube(query)
    return jsonify({"source": "youtube", "results": results})


@app.route("/api/explore/search-playlist")
def explore_search_playlist():
    """Search for a playlist by query, return its tracks."""
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"tracks": []})

    yt = _get_working_ytmusic()
    try:
        # Search for playlists matching the query
        results = yt.search(query, filter="playlists", limit=3)
        if results:
            pl_id = results[0].get("browseId", "")
            if pl_id:
                pl = yt.get_playlist(pl_id, limit=30)
                tracks = []
                for t in pl.get("tracks", []):
                    vid = t.get("videoId", "")
                    if not vid:
                        continue
                    artists = ", ".join(a.get("name", "") for a in t.get("artists", []) if a.get("name"))
                    thumbs = t.get("thumbnails", [])
                    duration = 0
                    if t.get("duration"):
                        duration = parse_yt_duration(t["duration"])
                    tracks.append({
                        "id": vid, "title": t.get("title", "Unknown"),
                        "artist": artists or "Unknown",
                        "album": t.get("album", {}).get("name", "") if t.get("album") else "",
                        "image": thumbs[-1].get("url", "") if thumbs else "",
                        "duration": duration,
                        "source": "youtube", "stream_url": None, "youtube_id": vid,
                    })
                if tracks:
                    return jsonify({"title": pl.get("title", query), "tracks": tracks})

        # Fallback: return song search results
        songs = search_ytmusic(query)
        return jsonify({"title": query, "tracks": songs})
    except Exception as e:
        log.error(f"[EXPLORE] search-playlist failed: {e}")
        songs = search_ytmusic(query)
        return jsonify({"title": query, "tracks": songs})


# ── Explore (Moods, Genres, Playlists) ──────────────────────────────────

_explore_cache = {"data": None, "ts": 0}

@app.route("/api/explore/categories")
def explore_categories():
    """Get YouTube Music mood & genre categories with curated playlists."""
    # Cache for 30 minutes
    if _explore_cache["data"] and (time.time() - _explore_cache["ts"]) < 1800:
        return jsonify(_explore_cache["data"])

    try:
        cats = ytmusic.get_mood_categories()
        result = {"categories": cats}
        _explore_cache["data"] = result
        _explore_cache["ts"] = time.time()
        return jsonify(result)
    except Exception as e:
        log.error(f"[EXPLORE] get_mood_categories failed: {e}")
        return jsonify({"categories": {}})


@app.route("/api/explore/playlists")
def explore_playlists():
    """Get playlists for a mood/genre category."""
    params = request.args.get("params", "")
    if not params:
        return jsonify({"playlists": []})

    try:
        playlists = ytmusic.get_mood_playlists(params)
        results = []
        for pl in playlists:
            thumbs = pl.get("thumbnails", [])
            results.append({
                "title": pl.get("title", ""),
                "playlistId": pl.get("playlistId", ""),
                "description": pl.get("description", ""),
                "image": thumbs[-1].get("url", "") if thumbs else "",
                "count": pl.get("count", ""),
                "author": pl.get("author", ""),
            })
        return jsonify({"playlists": results})
    except Exception as e:
        log.error(f"[EXPLORE] get_mood_playlists failed: {e}")
        return jsonify({"playlists": []})


@app.route("/api/explore/playlist/<playlist_id>")
def explore_playlist_tracks(playlist_id):
    """Get tracks from a YouTube Music playlist."""
    try:
        pl = ytmusic.get_playlist(playlist_id, limit=50)
        tracks = []
        for t in pl.get("tracks", []):
            vid = t.get("videoId", "")
            if not vid:
                continue
            artists = ", ".join(a.get("name", "") for a in t.get("artists", []) if a.get("name"))
            thumbs = t.get("thumbnails", [])
            duration = 0
            dur_text = t.get("duration", "")
            if dur_text:
                duration = parse_yt_duration(dur_text)
            tracks.append({
                "id": vid, "title": t.get("title", "Unknown"), "artist": artists or "Unknown",
                "album": t.get("album", {}).get("name", "") if t.get("album") else "",
                "image": thumbs[-1].get("url", "") if thumbs else "",
                "duration": duration,
                "source": "youtube", "stream_url": None, "youtube_id": vid,
            })
        return jsonify({
            "title": pl.get("title", ""),
            "description": pl.get("description", ""),
            "tracks": tracks,
        })
    except Exception as e:
        log.error(f"[EXPLORE] get_playlist failed: {e}")
        return jsonify({"title": "", "tracks": []})


@app.route("/api/recommendations/<video_id>")
def recommendations(video_id):
    """Get YouTube Music's exact Up Next recommendations.
    Always tries to find the ATV (audio) version of the song first,
    since ATV IDs produce audio-only recommendations (no video duplicates)."""
    if not _validate_video_id(video_id):
        return jsonify({"error": "Invalid video ID"}), 400

    log.info(f"[RECS] â”€â”€ Request for video: {video_id} â”€â”€")

    if video_id in _recs_cache:
        log.info(f"[RECS] âœ… Cache hit! Returning {len(_recs_cache[video_id])} cached results")
        return jsonify({"results": _recs_cache[video_id]})

    # Step 1: Find the YouTube Music song (ATV) version of this video
    song_id = _find_song_id(video_id)
    use_id = song_id if song_id else video_id

    # Step 2: Get recommendations using the song ID
    results = _get_ytmusic_recs(use_id)

    # Step 3: If still poor results, try original ID
    if len(results) < 3 and use_id != video_id:
        log.info(f"[RECS] Song ID gave few results, trying original ID")
        results = _get_ytmusic_recs(video_id)

    # Step 4: Final fallback
    if not results:
        log.info(f"[RECS] Falling back to yt-dlp mix...")
        results = _fetch_mix_fallback(video_id)

    # Cache
    if results:
        if len(_recs_cache) >= CACHE_MAX:
            _recs_cache.pop(next(iter(_recs_cache)))
        _recs_cache[video_id] = results[:25]

    log.info(f"[RECS] Returning {len(results)} recommendations")

    # Server-side prefetch: warm stream cache for next 2 tracks
    for r in results[:2]:
        rid = r.get("youtube_id", "")
        if rid and rid not in _stream_cache:
            executor.submit(_prefetch_stream, rid)

    return jsonify({"results": results[:25]})


def _prefetch_stream(video_id):
    """Background prefetch a stream URL into cache."""
    if video_id in _stream_cache:
        return
    try:
        cmd = _ytdlp_cmd([f"https://www.youtube.com/watch?v={video_id}", "--dump-json", "--no-warnings", "--quiet"])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            return
        data = json.loads(result.stdout)
        audio_url = None
        content_type = "audio/mp4"
        formats = data.get("formats", [])
        audio_formats = [f for f in formats if f.get("acodec") != "none" and f.get("vcodec") in ("none", None)]
        if audio_formats:
            audio_formats.sort(key=lambda f: f.get("abr", 0) or 0, reverse=True)
            audio_url = audio_formats[0].get("url")
            if audio_formats[0].get("ext") == "webm":
                content_type = "audio/webm"
        if not audio_url:
            audio_url = data.get("url")
        if not audio_url:
            return
        canonical_id = data.get("id", video_id)
        _evict_audio_cache()
        _audio_urls[canonical_id] = {"url": audio_url, "content_type": content_type, "ts": time.time()}
        resp = {
            "stream_url": audio_url,
            "video_id": canonical_id,
            "title": data.get("title", "Unknown"),
            "artist": data.get("channel", data.get("uploader", "Unknown")),
            "duration": data.get("duration", 0),
            "image": data.get("thumbnail", ""),
        }
        if len(_stream_cache) >= CACHE_MAX:
            _stream_cache.pop(next(iter(_stream_cache)))
        _stream_cache[video_id] = resp
        log.info(f"[PREFETCH] Cached: {data.get('title', video_id)}")
    except Exception:
        pass


def _find_song_id(video_id):
    """Convert any video ID to a YouTube Music song (ATV) ID."""
    try:
        title = ""
        author = ""
        try:
            song = ytmusic.get_song(video_id)
            vd = song.get("videoDetails", {})
            vtype = vd.get("musicVideoType", "")
            title = vd.get("title", "")
            author = vd.get("author", "")
            log.info(f"[RECS] Video type: {vtype}, title: {title}")
            if vtype == "MUSIC_VIDEO_TYPE_ATV":
                return video_id
        except Exception:
            pass

        if not title:
            try:
                cmd = _ytdlp_cmd([f"https://www.youtube.com/watch?v={video_id}", "--print", "%(title)s|||%(channel)s", "--no-warnings", "--quiet"])
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
                if r.returncode == 0 and r.stdout.strip():
                    parts = r.stdout.strip().split("|||")
                    title = parts[0] if parts else ""
                    author = parts[1] if len(parts) > 1 else ""
            except Exception:
                pass

        if not title:
            return None

        clean_title = re.sub(r'\b(official|full|video|song|audio|4k|8k|hd|lyric|lyrics)\b', '', title, flags=re.IGNORECASE)
        clean_title = re.sub(r'[\|\[\(].*', '', clean_title).strip()
        clean_title = re.sub(r'\s+', ' ', clean_title).strip()
        query = f"{clean_title} {author}".strip()
        log.info(f"[RECS] Searching for song: '{query}'")

        search_results = ytmusic.search(query, filter="songs", limit=5)
        if search_results:
            song_id = search_results[0].get("videoId", "")
            if song_id:
                log.info(f"[RECS] âœ… Found song: {video_id} â†’ {song_id}")
                return song_id
        return None
    except Exception as e:
        log.info(f"[RECS] _find_song_id error: {e}")
        return None


def _get_ytmusic_recs(video_id):
    """Get recommendations from ytmusicapi. Strictly returns audio tracks only."""
    try:
        watch = ytmusic.get_watch_playlist(videoId=video_id, limit=40)
        tracks = watch.get("tracks", [])

        atv_count = sum(1 for t in tracks if t.get("videoType") == "MUSIC_VIDEO_TYPE_ATV")
        other_count = len(tracks) - atv_count
        log.info(f"[RECS] ytmusicapi returned {len(tracks)} tracks (ATV: {atv_count}, Video: {other_count})")

        results = []
        seen_keys = set()
        seen_ids = set()

        for t in tracks:
            vid = t.get("videoId", "")
            if not vid or vid == video_id or vid in seen_ids:
                continue

            vtype = t.get("videoType", "")

            # STRICT: Only include ATV (audio) tracks.
            # Skip OMV (music videos), UGC (user uploads), OFFICIAL_SOURCE_MUSIC
            if vtype != "MUSIC_VIDEO_TYPE_ATV":
                # Exception: if there are very few ATVs, include OMVs as fallback
                if atv_count >= 5:
                    continue

            seen_ids.add(vid)

            title = t.get("title", "Unknown")
            artists = ", ".join(a.get("name", "") for a in t.get("artists", []) if a.get("name"))
            if not artists:
                artists = "Unknown"

            dedup_key = _normalize_for_dedup(title)
            if dedup_key in seen_keys:
                continue
            seen_keys.add(dedup_key)

            # Track counterpart to prevent both video+audio appearing
            counterpart = t.get("counterpart")
            if counterpart:
                cp_id = counterpart.get("videoId", "")
                if cp_id:
                    seen_ids.add(cp_id)

            thumbs = t.get("thumbnail", [])
            image = thumbs[-1].get("url", "") if thumbs else ""

            duration = 0
            length = t.get("length", "")
            if length:
                duration = parse_yt_duration(length)

            results.append({
                "id": vid, "title": title, "artist": artists,
                "album": t.get("album", {}).get("name", "") if t.get("album") else "",
                "image": image, "duration": duration,
                "source": "youtube", "stream_url": None, "youtube_id": vid,
            })
        return results
    except Exception as e:
        log.info(f"[RECS] _get_ytmusic_recs error: {e}")
        return []


def _normalize_for_dedup(title):
    """Normalize a song title for deduplication.
    Handles: video vs audio versions, (From "Movie") tags, suffixes like 'Video Song'."""
    t = title.lower()
    # Remove common suffixes/prefixes
    t = re.sub(r'\b(official|full|video|audio|song|music|lyric|lyrics|4k|8k|hd|'
               r'remastered|original|motion\s*picture|soundtrack|from)\b', '', t)
    # Remove anything in parentheses or brackets: (From "Youth"), [Official Video], etc.
    t = re.sub(r'[\(\[\{].*?[\)\]\}]', '', t)
    # Remove pipe-separated metadata: "| Vijay | Suriya | Deva"
    t = re.sub(r'\|.*$', '', t)
    # Remove dash-separated trailing metadata if it looks like credits
    # "Neelothi - Vikram Prabhu, K Akshay Kumar" -> "Neelothi"
    parts = t.split(' - ')
    if len(parts) > 1:
        # Keep only the first part (song name), unless it's very short
        if len(parts[0].strip()) >= 3:
            t = parts[0]
    # Remove all non-alphanumeric
    t = re.sub(r'[^a-z0-9\s]', '', t).strip()
    t = ' '.join(t.split())
    return t


def _fetch_mix_fallback(video_id):
    """Fallback: use yt-dlp RDAMVM mix if ytmusicapi fails."""
    try:
        url = f"https://www.youtube.com/watch?v={video_id}&list=RDAMVM{video_id}"
        log.info(f"[RECS] Fallback URL: {url}")
        cmd = _ytdlp_cmd([
            url,
            "--flat-playlist", "--dump-json",
            "--no-warnings", "--quiet",
            "--playlist-end", "25",
        ])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        results = []
        if result.returncode != 0 or not result.stdout.strip():
            return results
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
                vid = item.get("id", "")
                if not vid or vid == video_id:
                    continue
                thumb = ""
                thumbnails = item.get("thumbnails")
                if thumbnails and len(thumbnails) > 0:
                    thumb = thumbnails[-1].get("url", "")
                results.append({
                    "id": vid, "title": item.get("title", "Unknown"),
                    "artist": item.get("channel", item.get("uploader", "Unknown")),
                    "album": "", "image": thumb,
                    "duration": item.get("duration", 0) or 0,
                    "source": "youtube", "stream_url": None, "youtube_id": vid,
                })
            except json.JSONDecodeError:
                continue
        return results
    except Exception:
        return []


def parse_yt_duration(text):
    """Parse YouTube duration like '3:45' or '1:02:30' to seconds."""
    try:
        parts = [int(p) for p in text.strip().split(":")]
        if len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        elif len(parts) == 2:
            return parts[0] * 60 + parts[1]
        return 0
    except (ValueError, IndexError):
        return 0


_home_cache = {"data": None, "ts": 0}  # Cache home feed for 5 minutes

@app.route("/api/home")
def home_feed():
    """Home feed â€” cached for 5 minutes."""
    # Return cached if fresh (< 5 min)
    if _home_cache["data"] and (time.time() - _home_cache["ts"]) < 300:
        log.info("[HOME] Returning cached feed")
        return jsonify(_home_cache["data"])

    log.info("[HOME] Loading home feed...")
    history = load_history()
    feed = []

    recent = history.get("played", [])[:10]
    if recent:
        feed.append({
            "title": "Recently Played",
            "results": [{
                "id": p["youtube_id"],
                "title": p.get("title", "Unknown"),
                "artist": p.get("artist", "Unknown"),
                "album": "",
                "image": p.get("image", ""),
                "duration": p.get("duration", 0),
                "source": "youtube",
                "stream_url": None,
                "youtube_id": p["youtube_id"],
            } for p in recent]
        })

    sections = build_personalized_sections(history)[:3]

    def fetch_section(section):
        try:
            results = search_ytmusic(section["query"])
            if not results:
                return {"title": section["title"], "results": []}
            return {"title": section["title"], "results": results[:10]}
        except Exception as e:
            log.info(f"[HOME] Section '{section['title']}' failed: {e}")
            return {"title": section["title"], "results": []}

    futures = [executor.submit(fetch_section, s) for s in sections]
    for f in futures:
        try:
            data = f.result(timeout=10)
            if data["results"]:
                feed.append(data)
        except Exception:
            continue

    result = {"sections": feed}
    _home_cache["data"] = result
    _home_cache["ts"] = time.time()
    log.info(f"[HOME] Returning {len(feed)} sections (cached)")
    return jsonify(result)


def build_personalized_sections(history):
    """Build home feed sections based on preferences + listening history."""
    sections = []
    prefs = load_prefs()

    # 1. Sections from user preferences (languages + artists)
    if prefs:
        # Add sections for preferred artists
        for artist in prefs.get("artists", [])[:3]:
            name = artist.get("name", "")
            if name:
                sections.append({
                    "title": f"Best of {name}",
                    "query": f"{name} top songs hits",
                })

        # Add sections for preferred languages
        for lang in prefs.get("languages", [])[:3]:
            sections.append({
                "title": f"{lang} Hits",
                "query": f"latest {lang} songs hits",
            })

    # 2. Sections from listening history
    top_artists = get_top_artists(history, 5)
    recent_searches = history.get("searches", [])

    for artist in top_artists[:2]:
        # Don't duplicate preference artists
        pref_names = {a.get("name", "").lower() for a in (prefs or {}).get("artists", [])}
        if artist.lower() not in pref_names:
            sections.append({
                "title": f"More from {artist}",
                "query": f"{artist} songs",
            })

    seen_queries = set()
    for q in recent_searches[:2]:
        normalized = q.lower().strip()
        if normalized not in seen_queries:
            seen_queries.add(normalized)
            sections.append({
                "title": f'Based on "{q}"',
                "query": f"{q} similar songs",
            })

    # 3. Default sections
    defaults = [
        {"title": "Trending Now", "query": "trending music 2025 hits"},
        {"title": "Chill Vibes", "query": "chill lofi relaxing music"},
    ]

    # If no preferences and no history, show generic language sections
    if not prefs and not top_artists and not recent_searches:
        defaults.extend([
            {"title": "Tamil Hits", "query": "latest tamil songs hits"},
            {"title": "Hindi Hits", "query": "latest hindi songs bollywood"},
            {"title": "English Pop", "query": "top english pop songs 2025"},
        ])

    sections.extend(defaults)

    # Cap at 8 sections total
    return sections[:8]


def get_top_artists(history, n=5):
    """Get top N most listened artists from history."""
    artists = history.get("artists", {})
    if not artists:
        return []
    sorted_artists = sorted(artists.items(), key=lambda x: x[1], reverse=True)
    return [a[0] for a in sorted_artists[:n]]


@app.route("/api/yt/stream/<video_id>")
def yt_stream(video_id):
    """Extract audio info and return a proxy stream URL."""
    if not _validate_video_id(video_id):
        return jsonify({"error": "Invalid video ID"}), 400

    log.info(f"[STREAM] â”€â”€ Request for video: {video_id} â”€â”€")

    if video_id in _stream_cache:
        log.info(f"[STREAM] âœ… Cache hit!")
        return jsonify(_stream_cache[video_id])

    try:
        cmd = _ytdlp_cmd([
            f"https://www.youtube.com/watch?v={video_id}",
            "--dump-json", "--no-warnings", "--quiet",
        ])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            log.error(f"[STREAM] yt-dlp failed (code {result.returncode}): {result.stderr[:500]}")
            return jsonify({"error": "Could not extract audio"}), 500

        data = json.loads(result.stdout)
        canonical_id = data.get("id", video_id)
        title = data.get("title", "Unknown")
        artist = data.get("channel", data.get("uploader", "Unknown"))
        log.info(f"[STREAM] âœ… Resolved: {title} â€” {artist} (id: {canonical_id})")

        audio_url = None
        content_type = "audio/mp4"
        formats = data.get("formats", [])
        audio_formats = [
            f for f in formats
            if f.get("acodec") != "none" and f.get("vcodec") in ("none", None)
        ]
        if audio_formats:
            audio_formats.sort(key=lambda f: f.get("abr", 0) or 0, reverse=True)
            audio_url = audio_formats[0].get("url")
            ext = audio_formats[0].get("ext", "m4a")
            if ext == "webm":
                content_type = "audio/webm"
            log.info(f"[STREAM] âœ… Audio: {audio_formats[0].get('format_note','')} {audio_formats[0].get('abr','')}kbps ({ext})")

        if not audio_url:
            audio_url = data.get("url")

        if not audio_url:
            log.info(f"[STREAM] âŒ No audio stream found")
            return jsonify({"error": "No audio stream found"}), 404

        # Store the raw URL for the proxy, return a proxy URL to the client
        _evict_audio_cache()
        _audio_urls[canonical_id] = {"url": audio_url, "content_type": content_type, "ts": time.time()}

        response = {
            "stream_url": audio_url,
            "video_id": canonical_id,
            "title": title,
            "artist": artist,
            "duration": data.get("duration", 0),
            "image": data.get("thumbnail", ""),
        }

        if len(_stream_cache) >= CACHE_MAX:
            _stream_cache.pop(next(iter(_stream_cache)))
        _stream_cache[video_id] = response

        return jsonify(response)
    except subprocess.TimeoutExpired:
        log.info(f"[STREAM] âŒ Timeout")
        return jsonify({"error": "Timeout extracting audio"}), 504
    except Exception as e:
        log.info(f"[STREAM] âŒ Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/yt/proxy/<video_id>")
def yt_proxy(video_id):
    """Stream audio from YouTube CDN through our server â€” enables instant playback."""
    info = _audio_urls.get(video_id)
    if not info:
        return "Not found", 404

    url = info["url"]
    content_type = info["content_type"]

    # Support range requests for seeking
    headers = {"User-Agent": "Mozilla/5.0"}
    range_header = request.headers.get("Range")
    if range_header:
        headers["Range"] = range_header

    try:
        upstream = http_req.get(url, headers=headers, stream=True, timeout=30)

        def generate():
            for chunk in upstream.iter_content(chunk_size=64 * 1024):
                if chunk:
                    yield chunk

        resp_headers = {
            "Content-Type": content_type,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
        }
        if upstream.headers.get("Content-Length"):
            resp_headers["Content-Length"] = upstream.headers["Content-Length"]
        if upstream.headers.get("Content-Range"):
            resp_headers["Content-Range"] = upstream.headers["Content-Range"]

        status = 206 if range_header and upstream.status_code == 206 else 200
        return Response(generate(), status=status, headers=resp_headers)
    except Exception as e:
        log.info(f"[PROXY] âŒ Error: {e}")
        return "Stream error", 502


def search_ytmusic(query):
    """Search YouTube Music. Prefers songs (audio), falls back to videos."""
    results_raw = None

    try:
        results_raw = ytmusic.search(query, filter="songs", limit=20)
    except Exception as e:
        log.info(f"[SEARCH] ytmusicapi error: {e}")
        return []

    if not results_raw:
        try:
            results_raw = ytmusic.search(query, filter="videos", limit=20)
        except Exception:
            return []

    results = []
    seen_keys = set()
    for t in (results_raw or []):
        vid = t.get("videoId", "")
        if not vid:
            continue

        title = t.get("title", "Unknown")
        artists = ", ".join(a.get("name", "") for a in t.get("artists", []) if a.get("name"))
        if not artists:
            artists = "Unknown"

        dedup_key = _normalize_for_dedup(title)
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        thumbs = t.get("thumbnails", [])
        image = thumbs[-1].get("url", "") if thumbs else ""

        duration = 0
        dur_text = t.get("duration", "")
        if dur_text:
            duration = parse_yt_duration(dur_text)

        album = ""
        if t.get("album") and t["album"].get("name"):
            album = t["album"]["name"]

        results.append({
            "id": vid, "title": title, "artist": artists,
            "album": album, "image": image, "duration": duration,
            "source": "youtube", "stream_url": None, "youtube_id": vid,
        })
    return results


def search_youtube(query):
    """Search YouTube via yt-dlp. No API key needed."""
    try:
        cmd = _ytdlp_cmd([
            f"ytsearch20:{query} song",
            "--dump-json", "--flat-playlist",
            "--no-warnings", "--quiet",
        ])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if result.returncode != 0:
            return []

        results = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
                thumb = ""
                thumbnails = item.get("thumbnails")
                if thumbnails and len(thumbnails) > 0:
                    thumb = thumbnails[-1].get("url", "")
                results.append({
                    "id": item.get("id", ""),
                    "title": item.get("title", "Unknown"),
                    "artist": item.get("channel", item.get("uploader", "Unknown")),
                    "album": "",
                    "image": thumb,
                    "duration": item.get("duration", 0) or 0,
                    "source": "youtube",
                    "stream_url": None,
                    "youtube_id": item.get("id", ""),
                })
            except json.JSONDecodeError:
                continue
        return results
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return []


if __name__ == "__main__":
    log.info("=" * 40)
    log.info("🎵 Wavely Music Streaming")
    log.info("=" * 40)
    try:
        import yt_dlp
        log.info(f"yt-dlp {yt_dlp.version.__version__}")
    except ImportError:
        log.error("yt-dlp not found! Run: pip install yt-dlp")
    if os.path.exists(COOKIES_FILE):
        log.info(f"Cookies: {COOKIES_FILE} (found)")
    else:
        log.warning(f"Cookies: {COOKIES_FILE} (NOT FOUND - YouTube may block requests)")
    log.info(f"Data directory: {DATA_DIR}")
    log.info(f"Open http://localhost:{PORT}")
    log.info("=" * 40)
    app.run(debug=DEBUG, port=PORT, threaded=True)
/**
 * Wavely Music Player
 * Queue system + Up Next + Recommendations
 */
const qs = s => document.querySelector(s);
const qsa = s => document.querySelectorAll(s);

// DOM refs
const audio = qs("#audioPlayer");
const playIcon = qs("#playIcon");
const pauseIcon = qs("#pauseIcon");
const progressBar = qs("#progressBar");
const volumeBar = qs("#volumeBar");
const volumeBtn = qs("#volumeBtn");
const volHigh = qs("#volHigh");
const volMute = qs("#volMute");
const currentTimeEl = qs("#currentTime");
const totalTimeEl = qs("#totalTime");
const playerTitle = qs("#playerTitle");
const playerArtist = qs("#playerArtist");
const playerImage = qs("#playerImage");
const searchInput = qs("#searchInput");
const searchClear = qs("#searchClear");
const trackList = qs("#trackList");
const contentArea = qs("#contentArea");
const sourceBadge = qs("#sourceBadge");
const greetingEl = qs("#greeting");
const homeFeed = qs("#homeFeed");
const exploreGrid = qs("#exploreGrid");
const upNextPanel = qs("#upNextPanel");
const upNextList = qs("#upNextList");
const filterChips = qs("#filterChips");
const sidebarRecentList = qs("#sidebarRecentList");
const nowPlayingPage = qs("#nowPlayingPage");
const npImage = qs("#npImage");
const npArtPlaceholder = qs("#npArtPlaceholder");
const npTitle = qs("#npTitle");
const npArtist = qs("#npArtist");
const npQueueList = qs("#npQueueList");
const settingsView = qs("#settingsView");

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let nowPlaying = null;
let manualQueue = [];        // User-added tracks (Play Next / Add to Queue)
let autoQueue = [];          // Auto-generated from recommendations
let playHistory = [];
let isPlaying = false;
let prevVol = 80;
let recsLoading = false;
let currentView = "home";
let playedIds = new Set();  // Track played song IDs to avoid loops

// Combined queue: manual first, then auto
function getFullQueue() { return [...manualQueue, ...autoQueue]; }
// For backward compat, "queue" references
Object.defineProperty(window, 'queue', {
    get() { return getFullQueue(); },
    set(v) { autoQueue = v; manualQueue = []; }
});

// â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(async function init() {
    const h = new Date().getHours();
    greetingEl.textContent = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
    audio.volume = 0.8;
    fillSlider(volumeBar);

    // Check if onboarding needed
    try {
        const r = await fetch("/api/preferences");
        const d = await r.json();
        if (!d.preferences || !d.preferences.setup_done) {
            showOnboarding();
            return; // Don't load home feed yet
        }
    } catch {}

    // Set initial browser history state
    const initView = location.hash.replace("#","") || "home";
    history.replaceState({view: initView}, "", "#" + initView);

    if (initView === "home") { loadHomeFeed(); }
    else if (initView === "explore") { showExplore(); }
    else if (initView === "library") { showLibrary(); }
    else { loadHomeFeed(); }

    loadSidebarRecents();
})();

// â”€â”€ Onboarding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showOnboarding() {
    const ob = qs("#onboarding");
    ob.classList.remove("hidden");

    const selectedLangs = new Set();
    const selectedArtists = [];
    let searchTO;

    // Language selection
    qsa(".ob-chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const lang = chip.dataset.lang;
            if (selectedLangs.has(lang)) {
                selectedLangs.delete(lang);
                chip.classList.remove("selected");
            } else {
                selectedLangs.add(lang);
                chip.classList.add("selected");
            }
            qs("#obNextToArtists").disabled = selectedLangs.size === 0;
        });
    });

    // Next to artists step
    qs("#obNextToArtists").addEventListener("click", () => {
        qs("#obStep1").classList.add("hidden");
        qs("#obStep2").classList.remove("hidden");
        // Load suggested artists based on selected languages
        loadSuggestedArtists(Array.from(selectedLangs));
    });

    // Artist search
    qs("#obArtistSearch").addEventListener("input", () => {
        clearTimeout(searchTO);
        const q = qs("#obArtistSearch").value.trim();
        if (q.length >= 2) {
            searchTO = setTimeout(() => searchOnboardingArtists(q, selectedArtists), 400);
        }
    });

    // Finish
    qs("#obFinish").addEventListener("click", async () => {
        await fetch("/api/preferences", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                languages: Array.from(selectedLangs),
                artists: selectedArtists.map(a => ({name: a.name, id: a.id})),
            }),
        });
        ob.classList.add("hidden");
        loadHomeFeed();
        loadSidebarRecents();
    });

    async function loadSuggestedArtists(langs) {
        const grid = qs("#obArtistGrid");
        grid.innerHTML = '<div class="loading">Loading artists...</div>';

        const langArtistQueries = {
            "Tamil": ["A.R. Rahman", "Anirudh Ravichander", "Yuvan Shankar Raja", "Ilaiyaraja", "G.V. Prakash Kumar", "Sid Sriram", "Dhanush", "Vijay Antony", "Harris Jayaraj", "D. Imman", "Santhosh Narayanan", "Sean Roldan"],
            "Hindi": ["Arijit Singh", "Shreya Ghoshal", "Pritam", "Atif Aslam", "Neha Kakkar", "Vishal Mishra", "Jubin Nautiyal", "Badshah", "Honey Singh", "Armaan Malik", "Darshan Raval", "Sachin-Jigar"],
            "Telugu": ["S. Thaman", "Devi Sri Prasad", "Sid Sriram", "Anirudh Ravichander", "Armaan Malik", "Mangli", "Haricharan", "Mickey J Meyer"],
            "Malayalam": ["Sushin Shyam", "Prithviraj Sukumaran", "Vineeth Sreenivasan", "K.J. Yesudas", "K.S. Chithra", "Jakes Bejoy", "Hesham Abdul Wahab"],
            "Kannada": ["Vijay Prakash", "Sonu Nigam", "Arjun Janya", "Charan Raj", "Raghu Dixit"],
            "English": ["Taylor Swift", "Ed Sheeran", "The Weeknd", "Billie Eilish", "Drake", "Dua Lipa", "Bruno Mars", "Adele", "Post Malone", "Olivia Rodrigo", "Harry Styles", "Sabrina Carpenter"],
            "Korean": ["BTS", "BLACKPINK", "Stray Kids", "NewJeans", "IU", "TWICE", "aespa", "SEVENTEEN"],
            "Bengali": ["Arijit Singh", "Anupam Roy", "Shreya Ghoshal", "Rupam Islam", "Nachiketa"],
            "Punjabi": ["Diljit Dosanjh", "AP Dhillon", "Sidhu Moose Wala", "Karan Aujla", "Guru Randhawa", "Shubh"],
            "Japanese": ["YOASOBI", "Kenshi Yonezu", "LiSA", "Ado", "Official HIGE DANdism"],
            "Spanish": ["Bad Bunny", "Shakira", "Rosalia", "Rauw Alejandro", "Karol G"],
            "Arabic": ["Amr Diab", "Nancy Ajram", "Fairuz", "Mohamed Hamaki"],
            "French": ["Stromae", "Aya Nakamura", "Angele", "Indila"],
            "Marathi": ["Ajay-Atul", "Shankar Mahadevan", "Avadhoot Gupte"],
        };

        const allArtists = [];
        const seenNames = new Set();

        for (const lang of langs) {
            const seeds = langArtistQueries[lang] || [lang + " singer"];
            for (const seed of seeds) {
                try {
                    const r = await fetch("/api/preferences/artists/search?q=" + encodeURIComponent(seed));
                    const d = await r.json();
                    // Only take the FIRST result (most relevant) and only if it has an image
                    if (d.artists && d.artists.length > 0) {
                        const a = d.artists[0];
                        if (a.name && a.image && !seenNames.has(a.name.toLowerCase())) {
                            seenNames.add(a.name.toLowerCase());
                            allArtists.push(a);
                        }
                    }
                } catch {}
                if (allArtists.length >= 20) break;
            }
            if (allArtists.length >= 20) break;
        }

        if (allArtists.length === 0) {
            grid.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px">No artists found. Try searching above.</div>';
        } else {
            renderOnboardingArtists(allArtists, selectedArtists);
        }
    }

    async function searchOnboardingArtists(query, selected) {
        try {
            const r = await fetch("/api/preferences/artists/search?q=" + encodeURIComponent(query));
            const d = await r.json();
            renderOnboardingArtists(d.artists || [], selected);
        } catch {}
    }

    function renderOnboardingArtists(artists, selected) {
        const grid = qs("#obArtistGrid");
        grid.innerHTML = "";
        const selectedIds = new Set(selected.map(a => a.id));

        artists.forEach(a => {
            const card = document.createElement("div");
            card.className = "ob-artist" + (selectedIds.has(a.id) ? " selected" : "");
            card.innerHTML =
                '<img class="ob-artist-img" src="' + (a.image || '') + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
                '<div class="ob-artist-name">' + esc(a.name) + '</div>';
            card.addEventListener("click", () => {
                const idx = selectedArtists.findIndex(x => x.id === a.id);
                if (idx >= 0) {
                    selectedArtists.splice(idx, 1);
                    card.classList.remove("selected");
                } else {
                    selectedArtists.push(a);
                    card.classList.add("selected");
                }
                qs("#obSelectedCount").textContent = selectedArtists.length + " selected";
                qs("#obFinish").disabled = selectedArtists.length < 3;
            });
            grid.appendChild(card);
        });
    }
}

// â”€â”€ Prefetch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let prefetchedIds = new Set();
let streamCache = {};  // Client-side cache: youtube_id -> stream response

function prefetchNext(count) {
    count = count || 3;
    const full = [...manualQueue, ...autoQueue];
    let fetched = 0;
    for (let i = 0; i < full.length && fetched < count; i++) {
        const t = full[i];
        if (t.youtube_id && !prefetchedIds.has(t.youtube_id) && !streamCache[t.youtube_id]) {
            prefetchedIds.add(t.youtube_id);
            fetch("/api/yt/stream/" + t.youtube_id)
                .then(r => r.json())
                .then(d => {
                    if (!d.error) {
                        streamCache[t.youtube_id] = d;
                        console.log("[PREFETCH] Cached:", t.title);
                    }
                })
                .catch(() => {});
            fetched++;
        }
    }
}

// â”€â”€ Core Play Function â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function playTrackNow(track) {
    if (nowPlaying) {
        playHistory.push(nowPlaying);
        if (playHistory.length > 50) playHistory.shift();
    }

    nowPlaying = track;
    playedIds.add(track.youtube_id);
    playerTitle.textContent = "Loading: " + track.title;
    playerArtist.textContent = "Extracting audio...";
    setPlayerImage(track.image);

    qsa(".track-item").forEach(el => {
        el.classList.toggle("playing", el.dataset.vid === track.youtube_id);
    });

    recsLoading = true;
    renderUpNext();

    // Check client-side cache first â€” instant playback if prefetched
    let streamData = streamCache[track.youtube_id];

    if (!streamData) {
        // Not cached â€” fetch in parallel with recs
        const streamPromise = fetch("/api/yt/stream/" + track.youtube_id).then(r => r.json());
        loadRecommendations(track.youtube_id);

        try {
            streamData = await streamPromise;
        } catch {
            playerTitle.textContent = track.title;
            playerArtist.textContent = "Playback failed";
            return;
        }
    } else {
        // Cached â€” start recs in background
        console.log("[PLAY] Cache hit! Instant playback for:", track.title);
        loadRecommendations(track.youtube_id);
    }

    if (streamData.error) {
        playerTitle.textContent = track.title;
        playerArtist.textContent = "Could not load audio";
        recsLoading = false;
        return;
    }

    if (streamData.title) track.title = streamData.title;
    if (streamData.artist) track.artist = streamData.artist;
    if (streamData.image) track.image = streamData.image;
    if (streamData.duration) track.duration = streamData.duration;
    if (streamData.video_id && streamData.video_id !== track.youtube_id) {
        track.youtube_id = streamData.video_id;
        track.id = streamData.video_id;
    }

    playerTitle.textContent = track.title;
    playerArtist.textContent = track.artist;
    setPlayerImage(track.image);

    audio.src = streamData.stream_url;
    audio.play();
    setPlay(true);
    recordPlay(track);
    updateNowPlayingInfo();

    // Prefetch next songs immediately
    prefetchNext(3);
}

// â”€â”€ Next / Prev â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function playNext() {
    // Manual queue first, then auto
    if (manualQueue.length > 0) {
        const next = manualQueue.shift();
        renderUpNext();
        playTrackNow(next);
    } else if (autoQueue.length > 0) {
        const next = autoQueue.shift();
        renderUpNext();
        playTrackNow(next);
    } else if (recsLoading) {
        playerArtist.textContent = "Loading next...";
        const check = setInterval(() => {
            if (manualQueue.length > 0 || autoQueue.length > 0) {
                clearInterval(check);
                playNext();
            } else if (!recsLoading) {
                clearInterval(check);
            }
        }, 200);
        setTimeout(() => clearInterval(check), 10000);
    }
}

function playPrev() {
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
    }
    if (playHistory.length > 0) {
        if (nowPlaying) manualQueue.unshift(nowPlaying);
        const prev = playHistory.pop();
        nowPlaying = null;
        playTrackNow(prev);
        renderUpNext();
    }
}

// â”€â”€ Queue Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function addToQueue(track) {
    manualQueue.push({...track});
    showToast("Added to queue");
    renderUpNext();
}

function playNextInQueue(track) {
    manualQueue.unshift({...track});
    showToast("Playing next");
    renderUpNext();
}

function removeFromQueue(index) {
    const full = getFullQueue();
    if (index < manualQueue.length) {
        manualQueue.splice(index, 1);
    } else {
        autoQueue.splice(index - manualQueue.length, 1);
    }
    renderUpNext();
}

function clearManualQueue() {
    manualQueue = [];
    renderUpNext();
}

function playFromSearchResult(index, tracks) {
    const track = tracks[index];
    manualQueue = [];
    autoQueue = [];
    playedIds.clear();  // New session â€” reset played tracking
    playTrackNow(track);
}

function playSingle(track) {
    playTrackNow(track);
}

// â”€â”€ Recommendations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadRecommendations(videoId) {
    if (!videoId) return;
    recsLoading = true;

    try {
        const r = await fetch("/api/recommendations/" + videoId);
        const d = await r.json();
        if (d.results && d.results.length > 0) {
            // Filter out songs already played in this session + currently queued
            const skipIds = new Set([...manualQueue.map(t => t.youtube_id), ...playedIds]);
            if (nowPlaying) skipIds.add(nowPlaying.youtube_id);
            autoQueue = d.results.filter(t => !skipIds.has(t.youtube_id));
            renderUpNext();
            // Prefetch next 2 songs immediately
            prefetchNext(3);
        }
    } catch {}
    recsLoading = false;
}

// â”€â”€ Up Next Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderUpNext() {
    // Don't show Up Next on home/explore/library pages
    if (currentView === "home" || currentView === "explore" || currentView === "library") return;
    upNextPanel.classList.remove("hidden");
    upNextList.innerHTML = "";

    const full = getFullQueue();
    if (full.length === 0 && recsLoading) {
        upNextList.innerHTML = '<div class="loading">Loading recommendations...</div>';
        return;
    }
    if (full.length === 0) {
        upNextList.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px">Queue is empty</div>';
        return;
    }

    // Show manual queue section
    if (manualQueue.length > 0) {
        const hdr = document.createElement("div");
        hdr.className = "queue-section-hdr";
        hdr.innerHTML = '<span>Next in queue</span><button class="queue-clear-btn" aria-label="Clear queue">Clear</button>';
        hdr.querySelector(".queue-clear-btn").addEventListener("click", clearManualQueue);
        upNextList.appendChild(hdr);

        manualQueue.forEach((t, i) => {
            const el = makeQueueItem(t, i, true);
            upNextList.appendChild(el);
        });
    }

    // Show auto recommendations section
    if (autoQueue.length > 0) {
        if (manualQueue.length > 0) {
            const hdr = document.createElement("div");
            hdr.className = "queue-section-hdr";
            hdr.innerHTML = '<span>Recommendations</span>';
            upNextList.appendChild(hdr);
        }
        autoQueue.forEach((t, i) => {
            const el = makeQueueItem(t, manualQueue.length + i, false);
            upNextList.appendChild(el);
        });
    }

    if (!nowPlayingPage.classList.contains("hidden")) renderNpQueue();
}

function makeQueueItem(t, globalIndex, isManual) {
    const el = document.createElement("div");
    el.className = "up-next-item";
    el.setAttribute("role", "listitem");
    el.innerHTML =
        '<img class="up-next-thumb" src="' + (t.image || '') + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
        '<div class="up-next-info"><div class="up-next-title">' + esc(t.title) + '</div>' +
        '<div class="up-next-artist">' + esc(t.artist) + '</div></div>' +
        '<div class="up-next-actions">' +
        '<span class="up-next-duration">' + (t.duration ? fmt(t.duration) : '') + '</span>' +
        '<button class="q-remove-btn" aria-label="Remove" title="Remove from queue">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
        '</button></div>';
    el.querySelector(".up-next-info").addEventListener("click", () => {
        if (globalIndex < manualQueue.length) {
            manualQueue.splice(0, globalIndex + 1);
        } else {
            const manualLen = manualQueue.length;
            manualQueue = [];
            autoQueue.splice(0, globalIndex - manualLen + 1);
        }
        playTrackNow(t);
    });
    el.querySelector(".q-remove-btn").addEventListener("click", e => {
        e.stopPropagation();
        removeFromQueue(globalIndex);
    });
    return el;
}

qs("#closeUpNext").addEventListener("click", () => upNextPanel.classList.add("hidden"));

// â”€â”€ Now Playing Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
qs("#playerBar").querySelector(".player-left").addEventListener("click", () => {
    if (nowPlaying) openNowPlaying();
});

qs("#npClose").addEventListener("click", closeNowPlaying);

qsa(".np-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        qsa(".np-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        renderNpQueue();
    });
});

function openNowPlaying() {
    nowPlayingPage.classList.remove("hidden");
    updateNowPlayingInfo();
    renderNpQueue();
}

function closeNowPlaying() {
    nowPlayingPage.classList.add("hidden");
}

function updateNowPlayingInfo() {
    if (!nowPlaying) return;
    npTitle.textContent = nowPlaying.title;
    npArtist.textContent = nowPlaying.artist;
    if (nowPlaying.image) {
        npImage.src = nowPlaying.image;
        npImage.classList.remove("hidden");
    } else {
        npImage.classList.add("hidden");
        npImage.removeAttribute("src");
    }
}

function renderNpQueue() {
    npQueueList.innerHTML = "";

    // Don't show "now playing" in the queue — it's already on the left side
    const full = getFullQueue();
    if (full.length === 0 && recsLoading) {
        const ld = document.createElement("div");
        ld.className = "loading"; ld.textContent = "Loading recommendations...";
        npQueueList.appendChild(ld);
        return;
    }

    if (manualQueue.length > 0) {
        const hdr = document.createElement("div");
        hdr.className = "queue-section-hdr";
        hdr.innerHTML = '<span>Next in queue</span>';
        npQueueList.appendChild(hdr);
        manualQueue.forEach((t, i) => {
            const el = createNpQueueItem(t, false);
            el.addEventListener("click", () => { manualQueue.splice(0, i + 1); playTrackNow(t); });
            npQueueList.appendChild(el);
        });
    }

    if (autoQueue.length > 0) {
        const hdr = document.createElement("div");
        hdr.className = "queue-section-hdr";
        hdr.innerHTML = '<span>Recommendations</span>';
        npQueueList.appendChild(hdr);
        autoQueue.forEach((t, i) => {
            const el = createNpQueueItem(t, false);
            el.addEventListener("click", () => { manualQueue = []; autoQueue.splice(0, i + 1); playTrackNow(t); });
            npQueueList.appendChild(el);
        });
    }

    if (npQueueList.children.length === 0) {
        npQueueList.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:12px">No upcoming tracks</div>';
    }
}

function createNpQueueItem(t, isActive) {
    const el = document.createElement("div");
    el.className = "np-queue-item" + (isActive ? " now-active" : "");
    el.innerHTML =
        '<img class="np-q-thumb" src="' + (t.image || '') + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
        '<div class="np-q-info"><div class="np-q-title">' + esc(t.title) + '</div>' +
        '<div class="np-q-artist">' + esc(t.artist) + '</div></div>' +
        '<div class="np-q-dur">' + (t.duration ? fmt(t.duration) : '') + '</div>';
    return el;
}

// â”€â”€ Now Playing Controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const npProgressBar = qs("#npProgressBar");
const npCurrentTime = qs("#npCurrentTime");
const npTotalTime = qs("#npTotalTime");
const npPlayIcon = qs("#npPlayIcon");
const npPauseIcon = qs("#npPauseIcon");

qs("#npPlayPauseBtn").addEventListener("click", () => {
    if (!nowPlaying) return;
    if (isPlaying) { audio.pause(); setPlay(false); } else { audio.play(); setPlay(true); }
});
qs("#npPrevBtn").addEventListener("click", playPrev);
qs("#npNextBtn").addEventListener("click", playNext);

npProgressBar.addEventListener("input", () => {
    if (audio.duration) audio.currentTime = (npProgressBar.value / 100) * audio.duration;
    fillNpSlider();
});

function fillNpSlider() {
    const p = ((npProgressBar.value - npProgressBar.min) / (npProgressBar.max - npProgressBar.min)) * 100;
    npProgressBar.style.background = "linear-gradient(to right, var(--accent) " + p + "%, rgba(255,255,255,.1) " + p + "%)";
}

function syncNpControls() {
    // Sync play/pause icons
    npPlayIcon.classList.toggle("hidden", isPlaying);
    npPauseIcon.classList.toggle("hidden", !isPlaying);
    // Sync progress
    if (audio.duration && !isNaN(audio.duration)) {
        npProgressBar.value = (audio.currentTime / audio.duration) * 100;
        npCurrentTime.textContent = fmt(audio.currentTime);
        npTotalTime.textContent = fmt(audio.duration);
        fillNpSlider();
    }
}

// â”€â”€ Audio Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
audio.addEventListener("timeupdate", () => {
    if (audio.duration && !isNaN(audio.duration)) {
        progressBar.value = (audio.currentTime / audio.duration) * 100;
        currentTimeEl.textContent = fmt(audio.currentTime);
        fillSlider(progressBar);
        syncNpControls();
        // Auto-prefetch next song when current is 70% done
        if (audio.currentTime / audio.duration > 0.7) {
            prefetchNext(3);
        }
    }
});
audio.addEventListener("loadedmetadata", () => {
    totalTimeEl.textContent = fmt(audio.duration);
    npTotalTime.textContent = fmt(audio.duration);
});
audio.addEventListener("ended", () => {
    const full = getFullQueue();
    if (full.length > 0) {
        playNext();
    } else if (recsLoading) {
        playerArtist.textContent = "Loading next track...";
        const waitForRecs = setInterval(() => {
            if (getFullQueue().length > 0) {
                clearInterval(waitForRecs);
                playNext();
            } else if (!recsLoading) {
                clearInterval(waitForRecs);
                setPlay(false);
            }
        }, 200);
        setTimeout(() => clearInterval(waitForRecs), 15000);
    } else {
        setPlay(false);
    }
});
audio.addEventListener("error", () => {
    if (nowPlaying) { playerTitle.textContent = "Playback error"; setPlay(false); }
});

progressBar.addEventListener("input", () => {
    if (audio.duration) audio.currentTime = (progressBar.value / 100) * audio.duration;
    fillSlider(progressBar);
});
volumeBar.addEventListener("input", () => {
    audio.volume = volumeBar.value / 100; prevVol = volumeBar.value;
    updVolIcon(audio.volume); fillSlider(volumeBar);
});
volumeBtn.addEventListener("click", () => {
    if (audio.volume > 0) { prevVol = volumeBar.value; audio.volume = 0; volumeBar.value = 0; }
    else { audio.volume = prevVol / 100; volumeBar.value = prevVol; }
    updVolIcon(audio.volume); fillSlider(volumeBar);
});

qs("#playPauseBtn").addEventListener("click", () => {
    if (!nowPlaying) return;
    if (isPlaying) { audio.pause(); setPlay(false); } else { audio.play(); setPlay(true); }
});
qs("#prevBtn").addEventListener("click", playPrev);
qs("#nextBtn").addEventListener("click", playNext);

function updVolIcon(v) { volHigh.classList.toggle("hidden", v === 0); volMute.classList.toggle("hidden", v > 0); }
function fillSlider(el) {
    const p = ((el.value - el.min) / (el.max - el.min)) * 100;
    // Progress bar: always green for played portion. Volume: always white.
    const c = el === progressBar ? "var(--accent)" : "var(--text-base)";
    el.style.background = "linear-gradient(to right, " + c + " " + p + "%, rgba(255,255,255,.1) " + p + "%)";
}
function setPlay(on) {
    isPlaying = on;
    playIcon.classList.toggle("hidden", on);
    pauseIcon.classList.toggle("hidden", !on);
    npPlayIcon.classList.toggle("hidden", on);
    npPauseIcon.classList.toggle("hidden", !on);
    fillSlider(progressBar);
}

// â”€â”€ History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function recordPlay(t) {
    fetch("/api/history/played", { method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({youtube_id: t.youtube_id, title: t.title, artist: t.artist, image: t.image, duration: t.duration})
    }).then(() => loadSidebarRecents()).catch(() => {});
}
function recordSearch(q) {
    fetch("/api/history/search", { method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({query: q}) }).catch(() => {});
}
async function loadSidebarRecents() {
    try {
        const r = await fetch("/api/history/recent"); const d = await r.json();
        sidebarRecentList.innerHTML = "";
        (d.results || []).slice(0, 6).forEach(t => {
            const img = document.createElement("img");
            img.className = "recent-dot"; img.src = t.image || ""; img.alt = t.title; img.title = t.title;
            img.onerror = () => img.style.display = "none";
            img.addEventListener("click", () => playSingle(t));
            sidebarRecentList.appendChild(img);
        });
    } catch {}
}

// â”€â”€ Home Feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function loadHomeFeed() {
    currentView = "home";

    contentArea.classList.add("hidden");
    trackList.classList.add("hidden");
    exploreGrid.classList.add("hidden");
    settingsView.classList.add("hidden");
    upNextPanel.classList.add("hidden");
    filterChips.classList.remove("hidden");
    homeFeed.classList.remove("hidden");

    // Show "Recently Played" immediately from sidebar data (no API wait)
    const recentDots = sidebarRecentList.querySelectorAll(".recent-dot");
    if (recentDots.length > 0) {
        // We have recent data â€” show it while feed loads
        homeFeed.innerHTML = '<div class="feed-section"><div class="feed-section-header"><h2>Recently Played</h2></div><div class="feed-cards">' +
            Array.from(recentDots).map(img =>
                '<div class="feed-card"><div class="feed-card-img-wrap"><img class="feed-card-img" src="' + img.src + '" alt="' + esc(img.title) + '"></div>' +
                '<div class="feed-card-meta"><div class="feed-card-title">' + esc(img.title) + '</div></div></div>'
            ).join('') + '</div></div>' + skeleton(2, 5);
    } else {
        homeFeed.innerHTML = skeleton(3, 5);
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const r = await fetch("/api/home", { signal: controller.signal });
        clearTimeout(timeout);
        const d = await r.json();
        if (d.sections && d.sections.length > 0) {
            renderFeed(d.sections);
        } else {
            homeFeed.innerHTML = '';
            contentArea.classList.remove("hidden");
            contentArea.innerHTML = '<div class="hero-welcome"><h1>Good ' +
                (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening') +
                '</h1><p>Search for any song to start listening.</p></div>';
        }
    } catch (err) {
        console.error("[HOME] Feed error:", err);
        // If timeout, show what we have (recently played from skeleton)
        if (homeFeed.querySelector(".feed-card-img")) {
            // Remove skeleton, keep the recently played cards
            homeFeed.querySelectorAll(".skeleton-card, .skeleton-img, .skeleton-text").forEach(el => {
                const parent = el.closest(".feed-section");
                if (parent && !parent.querySelector(".feed-card-img")) parent.remove();
            });
        } else {
            homeFeed.innerHTML = '';
            contentArea.classList.remove("hidden");
            contentArea.innerHTML = '<div class="hero-welcome"><h1>Good ' +
                (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening') +
                '</h1><p>Search for any song to start listening.</p></div>';
        }
    }
}
function skeleton(rows, cols) {
    let h = ''; for (let s = 0; s < rows; s++) {
        h += '<div class="feed-section"><div class="feed-section-header"><div class="skeleton-text" style="width:160px;height:20px"></div></div><div class="feed-cards">';
        for (let i = 0; i < cols; i++) h += '<div class="skeleton-card"><div class="skeleton-img"></div><div class="skeleton-text"></div><div class="skeleton-text short"></div></div>';
        h += '</div></div>';
    } return h;
}
function renderFeed(sections) {
    homeFeed.innerHTML = "";
    sections.forEach(sec => {
        const el = document.createElement("div"); el.className = "feed-section";
        let cards = "";
        sec.results.forEach(t => {
            cards += '<div class="feed-card">' +
                '<div class="feed-card-img-wrap">' +
                '<img class="feed-card-img" src="' + (t.image || '') + '" alt="' + esc(t.title) + '" loading="lazy" onerror="this.style.background=\'var(--bg-card)\'">' +
                '<button class="feed-card-play" aria-label="Play"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>' +
                '<button class="heart-btn" data-ytid="' + t.youtube_id + '" aria-label="Like">' +
                '<svg class="heart-empty" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
                '<svg class="heart-filled hidden" width="14" height="14" viewBox="0 0 24 24" fill="var(--red)"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
                '</button>' +
                '</div>' +
                '<div class="feed-card-meta">' +
                '<div class="feed-card-title">' + esc(t.title) + '</div>' +
                '<div class="feed-card-artist">' + esc(t.artist) + '</div>' +
                '</div>' +
                '<button class="feed-card-menu" aria-label="More options">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>' +
                '</button></div>';
        });
        el.innerHTML = '<div class="feed-section-header"><h2>' + esc(sec.title) + '</h2></div><div class="feed-cards">' + cards + '</div>';
        el.querySelectorAll(".feed-card").forEach((card, i) => {
            const t = sec.results[i];
            card.querySelector(".feed-card-play").addEventListener("click", e => { e.stopPropagation(); playSingle(t); });
            card.querySelector(".feed-card-img-wrap").addEventListener("click", e => {
                if (e.target.closest(".heart-btn") || e.target.closest(".feed-card-play")) return;
                e.stopPropagation(); playSingle(t);
            });
            card.querySelector(".feed-card-menu").addEventListener("click", e => { e.stopPropagation(); showContextMenu(e, t); });

            // Heart button
            const heartBtn = card.querySelector(".heart-btn");
            checkAndSetHeart(heartBtn, t.youtube_id);
            heartBtn.addEventListener("click", e => { e.stopPropagation(); toggleLikeWithHeart(heartBtn, t); });
        });
        homeFeed.appendChild(el);
    });

    // Batch-check all likes in one request
    const allIds = [];
    sections.forEach(sec => sec.results.forEach(t => { if (t.youtube_id) allIds.push(t.youtube_id); }));
    loadLikedStatus(allIds).then(() => {
        homeFeed.querySelectorAll(".heart-btn").forEach(btn => {
            const id = btn.dataset.ytid;
            if (id && likedCache[id]) setHeartState(btn, true);
        });
    });
}

// â”€â”€ Explore â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Gradient colors for mood/genre cards
const EXPLORE_COLORS = [
    "linear-gradient(135deg,#e13300,#e8a200)",
    "linear-gradient(135deg,#1e3264,#5038a0)",
    "linear-gradient(135deg,#8c1932,#e8115b)",
    "linear-gradient(135deg,#148a08,#1fdf64)",
    "linear-gradient(135deg,#056952,#1ed760)",
    "linear-gradient(135deg,#5038a0,#a0c4ff)",
    "linear-gradient(135deg,#ba5d07,#e8a200)",
    "linear-gradient(135deg,#1db954,#056952)",
    "linear-gradient(135deg,#333,#777)",
    "linear-gradient(135deg,#0d73ec,#60cfff)",
    "linear-gradient(135deg,#503750,#8c1932)",
    "linear-gradient(135deg,#e8a200,#503750)",
];

async function showExplore() {
    currentView = "explore"; hideAll(); filterChips.classList.add("hidden");
    exploreGrid.classList.remove("hidden");
    exploreGrid.innerHTML = '<div class="loading">Loading explore...</div>';

    const EXPLORE_IMAGES = {
        "chill": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=300&h=300&fit=crop",
        "party": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&h=300&fit=crop",
        "workout": "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=300&h=300&fit=crop",
        "romance": "https://images.unsplash.com/photo-1518199266791-5375a83190b7?w=300&h=300&fit=crop",
        "focus": "https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?w=300&h=300&fit=crop",
        "feel good": "https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=300&h=300&fit=crop",
        "energize": "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=300&h=300&fit=crop",
        "sleep": "https://images.unsplash.com/photo-1531353826977-0941b4779a1c?w=300&h=300&fit=crop",
        "sad": "https://images.unsplash.com/photo-1516585427167-9f4af9627e6c?w=300&h=300&fit=crop",
        "commute": "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=300&h=300&fit=crop",
        "gaming": "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=300&h=300&fit=crop",
        "hits": "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop",
        "classics": "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop",
        "new": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop",
        "best of": "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=300&h=300&fit=crop",
        "tamil": "https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=300&h=300&fit=crop",
        "hindi": "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=300&h=300&fit=crop",
        "default": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop",
    };
    let colorIdx = 0;

    const getImg = (t) => {
        t = t.toLowerCase();
        for (const [k, u] of Object.entries(EXPLORE_IMAGES)) { if (t.includes(k)) return u; }
        return EXPLORE_IMAGES["default"];
    };

    const addSection = (title, items) => {
        const section = document.createElement("div");
        section.className = "explore-section";
        const hdr = document.createElement("div");
        hdr.className = "explore-section-hdr";
        hdr.innerHTML = "<h2>" + esc(title) + "</h2>";
        section.appendChild(hdr);
        const grid = document.createElement("div");
        grid.className = "explore-section-cards";
        items.forEach(item => {
            const img = getImg(item.title + " " + title);
            const card = document.createElement("div");
            card.className = "explore-card";
            card.style.background = EXPLORE_COLORS[colorIdx % EXPLORE_COLORS.length];
            card.innerHTML =
                '<img class="explore-card-bg" src="' + img + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
                '<div class="explore-card-overlay"></div>' +
                '<span>' + esc(item.title) + '</span>';
            card.addEventListener("click", () => loadCategory(item.query, item.title));
            grid.appendChild(card);
            colorIdx++;
        });
        section.appendChild(grid);
        exploreGrid.appendChild(section);
    };

    try {
        const prefsResp = await fetch("/api/preferences");
        const prefsData = await prefsResp.json();
        const prefs = prefsData.preferences || {};
        const userLangs = prefs.languages || [];
        const userArtists = (prefs.artists || []).map(a => a.name);

        exploreGrid.innerHTML = "";

        if (userLangs.length > 0) {
            if (userArtists.length > 0) {
                addSection("Your Artist Mixes", userArtists.slice(0, 6).map(a => ({
                    title: "Best of " + a, query: a + " top songs hits"
                })));
            }
            const moods = ["Chill", "Party", "Workout", "Romance", "Focus", "Feel Good", "Energize", "Sleep"];
            for (const lang of userLangs.slice(0, 3)) {
                addSection(lang + " Moods", moods.map(m => ({
                    title: m, query: lang + " " + m.toLowerCase() + " songs playlist"
                })));
            }
            addSection("Quick Picks", [
                ...userLangs.map(l => ({title: l + " Hits", query: "latest " + l + " hits songs"})),
                ...userLangs.map(l => ({title: l + " Classics", query: l + " classic old songs hits"})),
                ...userLangs.map(l => ({title: "New " + l, query: "new " + l + " songs releases"})),
            ].slice(0, 8));
        } else {
            try {
                const catsResp = await fetch("/api/explore/categories");
                const catsData = await catsResp.json();
                for (const [section, items] of Object.entries(catsData.categories || {})) {
                    addSection(section, items.map(item => ({title: item.title, query: item.title + " music playlist"})));
                }
            } catch {}
        }

        if (exploreGrid.children.length === 0) {
            exploreGrid.innerHTML = '<div class="welcome"><h2>Set your preferences</h2><p>Go to Settings to personalize</p></div>';
        }
    } catch (err) {
        console.error("[EXPLORE]", err);
        exploreGrid.innerHTML = '<div class="welcome"><h2>Could not load</h2><p>Try again later</p></div>';
    }
}

async function showMoodPlaylists(params, title) {
    hideAll(); filterChips.classList.add("hidden");
    contentArea.classList.remove("hidden");
    contentArea.innerHTML = '<div class="loading">Loading ' + esc(title) + ' playlists...</div>';

    try {
        const r = await fetch("/api/explore/playlists?params=" + encodeURIComponent(params));
        const d = await r.json();
        const playlists = d.playlists || [];

        if (playlists.length === 0) {
            contentArea.innerHTML = '<div class="welcome"><h2>No playlists</h2></div>';
            return;
        }

        // Show as feed cards
        let cards = "";
        playlists.slice(0, 30).forEach(pl => {
            cards += '<div class="feed-card" data-plid="' + esc(pl.playlistId) + '">' +
                '<div class="feed-card-img-wrap">' +
                '<img class="feed-card-img" src="' + (pl.image || '') + '" alt="' + esc(pl.title) + '" loading="lazy">' +
                '<button class="feed-card-play" aria-label="Play"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>' +
                '</div>' +
                '<div class="feed-card-meta">' +
                '<div class="feed-card-title">' + esc(pl.title) + '</div>' +
                '<div class="feed-card-artist">' + esc(pl.description || pl.count || '') + '</div>' +
                '</div></div>';
        });

        contentArea.innerHTML = '<div class="explore-pl-view">' +
            '<h2 class="explore-pl-title">' + esc(title) + '</h2>' +
            '<div class="feed-cards">' + cards + '</div></div>';

        contentArea.querySelectorAll(".feed-card").forEach((card, i) => {
            const pl = playlists[i];
            card.querySelector(".feed-card-play").addEventListener("click", e => {
                e.stopPropagation();
                loadPlaylistAndPlay(pl.playlistId, pl.title);
            });
            card.addEventListener("click", () => loadPlaylistAndPlay(pl.playlistId, pl.title));
        });
    } catch {
        contentArea.innerHTML = '<div class="welcome"><h2>Error</h2><p>Could not load playlists</p></div>';
    }
}

async function loadPlaylistAndPlay(playlistId, title) {
    hideAll(); filterChips.classList.add("hidden");
    contentArea.classList.remove("hidden");
    contentArea.innerHTML = '<div class="loading">Loading ' + esc(title) + '...</div>';

    try {
        const r = await fetch("/api/explore/playlist/" + encodeURIComponent(playlistId));
        const d = await r.json();
        if (d.tracks && d.tracks.length > 0) {
            contentArea.classList.add("hidden");
            trackList.classList.remove("hidden");
            renderTracks(d.tracks);
            // Auto-play first track
            manualQueue = d.tracks.slice(1);
            autoQueue = [];
            playedIds.clear();
            playTrackNow(d.tracks[0]);
        } else {
            contentArea.innerHTML = '<div class="welcome"><h2>Empty playlist</h2></div>';
        }
    } catch {
        contentArea.innerHTML = '<div class="welcome"><h2>Error</h2></div>';
    }
}

// â”€â”€ Search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let searchTO;
searchInput.addEventListener("input", () => {
    clearTimeout(searchTO);
    const v = searchInput.value.trim();
    searchClear.classList.toggle("hidden", v.length === 0);
    if (v.length >= 2) searchTO = setTimeout(doSearch, 600);
    else if (v.length === 0) goHome();
});
searchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") { clearTimeout(searchTO); doSearch(); }
    if (e.key === "Escape") { searchInput.value = ""; searchInput.blur(); searchClear.classList.add("hidden"); goHome(); }
});
searchClear.addEventListener("click", () => { searchInput.value = ""; searchClear.classList.add("hidden"); searchInput.focus(); goHome(); });

let lastSearchResults = [];

async function doSearch() {
    const q = searchInput.value.trim(); if (!q) return;
    recordSearch(q);
    hideAll(); filterChips.classList.add("hidden");
    contentArea.classList.remove("hidden");
    contentArea.innerHTML = '<div class="loading">Searching...</div>';
    try {
        const r = await fetch("/api/search?q=" + encodeURIComponent(q));
        const d = await r.json();
        if (d.results && d.results.length > 0) {
            lastSearchResults = d.results;
            showBadge(); contentArea.classList.add("hidden");
            trackList.classList.remove("hidden"); renderTracks(d.results);
        } else {
            contentArea.innerHTML = '<div class="welcome"><h2>No results</h2><p>Nothing found for "' + esc(q) + '"</p></div>';
            sourceBadge.classList.add("hidden");
        }
    } catch { contentArea.innerHTML = '<div class="welcome"><h2>Error</h2><p>Could not reach server</p></div>'; }
}

// â”€â”€ Filter Chips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
qsa(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
        qsa(".chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const f = chip.dataset.filter;
        if (f === "all") loadHomeFeed(); else loadCategory(f, chip.textContent.trim());
    });
});

async function loadCategory(query, label) {
    hideAll(); filterChips.classList.remove("hidden");
    contentArea.classList.remove("hidden");
    contentArea.innerHTML = '<div class="loading">Loading ' + esc(label) + '...</div>';
    try {
        // Search for a playlist matching the query
        const r = await fetch("/api/explore/search-playlist?q=" + encodeURIComponent(query));
        const d = await r.json();
        if (d.tracks && d.tracks.length > 0) {
            showBadge();
            contentArea.classList.add("hidden"); trackList.classList.remove("hidden");
            renderTracks(d.tracks);
        } else {
            contentArea.innerHTML = '<div class="welcome"><h2>No tracks</h2><p>No ' + esc(label) + ' music found</p></div>';
        }
    } catch { contentArea.innerHTML = '<div class="welcome"><h2>Error</h2><p>Could not load tracks</p></div>'; }
}

// â”€â”€ Nav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€ Nav (desktop + mobile) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function handleNav(view, pushHistory) {
    if (pushHistory !== false) {
        history.pushState({view: view}, "", "#" + view);
    }
    qsa(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    qsa(".mob-nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    if (view === "home") goHome();
    else if (view === "explore") showExplore();
    else if (view === "library") showLibrary();
    else if (view === "settings") showSettings();
}

window.addEventListener("popstate", (e) => {
    const view = (e.state && e.state.view) || (location.hash.replace("#","") || "home");
    handleNav(view, false);
});

qsa(".nav-item").forEach(btn => {
    btn.addEventListener("click", e => { e.preventDefault(); handleNav(btn.dataset.view); });
});
qsa(".mob-nav-item").forEach(btn => {
    btn.addEventListener("click", e => { e.preventDefault(); handleNav(btn.dataset.view); });
});

// Logo click -> Home
qs(".brand-fixed").addEventListener("click", () => handleNav("home"));
qs(".brand-fixed").style.cursor = "pointer";

function goHome() {
    searchInput.value = ""; searchClear.classList.add("hidden"); sourceBadge.classList.add("hidden");
    qsa(".chip").forEach(c => c.classList.remove("active"));
    var fc = qs(".chip"); if (fc) fc.classList.add("active");
    loadHomeFeed();
}
async function showLibrary() {
    currentView = "library"; hideAll(); filterChips.classList.add("hidden");
    contentArea.classList.remove("hidden");
    contentArea.innerHTML = '<div class="loading">Loading library...</div>';

    try {
        const [histResp, plResp, likesResp] = await Promise.all([
            fetch("/api/history/recent"),
            fetch("/api/playlists"),
            fetch("/api/likes"),
        ]);
        const recent = (await histResp.json()).results || [];
        const playlists = (await plResp.json()).playlists || [];
        const liked = (await likesResp.json()).tracks || [];

        let html = '<div class="library-view">';

        // Library tabs
        html += '<div class="lib-tabs" id="libTabs">' +
            '<button class="lib-tab active" data-libtab="playlists">Playlists</button>' +
            '<button class="lib-tab" data-libtab="liked">Liked Songs (' + liked.length + ')</button>' +
            '<button class="lib-tab" data-libtab="recent">Recent</button>' +
            '</div>';

        // Playlists tab content
        html += '<div class="lib-tab-content" id="libPlaylists">';
        html += '<button class="lib-create-pl-btn" id="libCreatePlBtn">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>' +
            '<span>New Playlist</span></button>';
        if (playlists.length > 0) {
            playlists.forEach(pl => {
                const thumb = pl.tracks.length > 0 && pl.tracks[0].image ? pl.tracks[0].image : '';
                html += '<div class="lib-pl-card" data-plid="' + pl.id + '">' +
                    '<div class="lib-pl-art">' + (thumb ? '<img src="' + thumb + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius)">' : '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" opacity="0.3"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>') + '</div>' +
                    '<div class="lib-pl-info"><div class="lib-pl-name">' + esc(pl.name) + '</div>' +
                    '<div class="lib-pl-count">' + pl.tracks.length + ' tracks</div></div>' +
                    '<button class="lib-pl-del" data-plid="' + pl.id + '" aria-label="Delete">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button></div>';
            });
        } else {
            html += '<p class="lib-empty">No playlists yet. Use the â‹® menu on any song to create one.</p>';
        }
        html += '</div>';

        // Liked songs tab content (hidden by default)
        html += '<div class="lib-tab-content hidden" id="libLiked">';
        if (liked.length > 0) {
            html += '<div class="lib-liked-header"><span>' + liked.length + ' songs</span>' +
                '<button class="btn-primary lib-play-all" id="libPlayLiked">Play all</button></div>';
        } else {
            html += '<p class="lib-empty">Songs you like will appear here. Use the â¤ï¸ option in the â‹® menu.</p>';
        }
        html += '</div>';

        // Recent tab content (hidden by default)
        html += '<div class="lib-tab-content hidden" id="libRecent"></div>';

        html += '</div>';
        contentArea.innerHTML = html;

        // Tab switching
        qsa(".lib-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                qsa(".lib-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                qs("#libPlaylists").classList.toggle("hidden", tab.dataset.libtab !== "playlists");
                qs("#libLiked").classList.toggle("hidden", tab.dataset.libtab !== "liked");
                qs("#libRecent").classList.toggle("hidden", tab.dataset.libtab !== "recent");
                trackList.classList.add("hidden");

                if (tab.dataset.libtab === "liked" && liked.length > 0) {
                    const tracks = liked.map(t => ({
                        id: t.youtube_id, title: t.title, artist: t.artist,
                        album: "", image: t.image, duration: t.duration,
                        source: "youtube", stream_url: null, youtube_id: t.youtube_id,
                    }));
                    trackList.classList.remove("hidden");
                    renderTracks(tracks);
                } else if (tab.dataset.libtab === "recent" && recent.length > 0) {
                    trackList.classList.remove("hidden");
                    renderTracks(recent);
                }
            });
        });

        // Play all liked
        const playLikedBtn = qs("#libPlayLiked");
        if (playLikedBtn) {
            playLikedBtn.addEventListener("click", () => {
                const tracks = liked.map(t => ({
                    id: t.youtube_id, title: t.title, artist: t.artist,
                    album: "", image: t.image, duration: t.duration,
                    source: "youtube", stream_url: null, youtube_id: t.youtube_id,
                }));
                if (tracks.length > 0) {
                    manualQueue = tracks.slice(1);
                    autoQueue = [];
                    playTrackNow(tracks[0]);
                    renderUpNext();
                }
            });
        }

        // Create playlist button
        const createBtn = qs("#libCreatePlBtn");
        if (createBtn) {
            createBtn.addEventListener("click", async () => {
                const name = prompt("Playlist name:");
                if (!name) return;
                await fetch("/api/playlists", {
                    method: "POST", headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({name: name}),
                });
                showToast("Playlist created");
                showLibrary();
            });
        }

        // Playlist card clicks
        contentArea.querySelectorAll(".lib-pl-card").forEach(card => {
            card.addEventListener("click", e => {
                if (e.target.closest(".lib-pl-del")) return;
                const pl = playlists.find(p => p.id === card.dataset.plid);
                if (pl && pl.tracks.length > 0) {
                    const tracks = pl.tracks.map(t => ({
                        id: t.youtube_id, title: t.title, artist: t.artist,
                        album: "", image: t.image, duration: t.duration,
                        source: "youtube", stream_url: null, youtube_id: t.youtube_id,
                    }));
                    trackList.classList.remove("hidden");
                    renderTracks(tracks);
                } else {
                    showToast("Playlist is empty");
                }
            });
        });

        // Delete playlist
        contentArea.querySelectorAll(".lib-pl-del").forEach(btn => {
            btn.addEventListener("click", async e => {
                e.stopPropagation();
                if (confirm("Delete this playlist?")) {
                    await fetch("/api/playlists/" + btn.dataset.plid, {method: "DELETE"});
                    showLibrary();
                }
            });
        });
    } catch {
        contentArea.innerHTML = '<div class="welcome"><h2>Library</h2><p>Could not load</p></div>';
    }
}

// â”€â”€ Rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderTracks(tracks) {
    trackList.innerHTML = "";
    tracks.forEach((t, i) => {
        const el = document.createElement("div");
        el.className = "track-item"; el.setAttribute("role", "listitem"); el.setAttribute("tabindex", "0");
        el.dataset.vid = t.youtube_id;
        el.innerHTML =
            '<span class="track-num">' + (i + 1) + '</span>' +
            '<div class="track-thumb-wrap">' +
            '<img class="track-thumb" src="' + (t.image || '') + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' +
            '<div class="play-overlay"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>' +
            '<button class="heart-btn" data-ytid="' + t.youtube_id + '" aria-label="Like">' +
            '<svg class="heart-empty" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
            '<svg class="heart-filled hidden" width="16" height="16" viewBox="0 0 24 24" fill="var(--red)"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
            '</button></div>' +
            '<div class="track-info"><div class="track-name">' + esc(t.title) + '</div><div class="track-artist">' + esc(t.artist) + '</div></div>' +
            '<button class="track-menu-btn" aria-label="More options">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>' +
            '</button>';

        // Check like status
        const heartBtn = el.querySelector(".heart-btn");
        checkAndSetHeart(heartBtn, t.youtube_id);

        heartBtn.addEventListener("click", e => {
            e.stopPropagation();
            toggleLikeWithHeart(heartBtn, t);
        });

        el.querySelector(".track-info").addEventListener("click", () => playFromSearchResult(i, tracks));
        el.querySelector(".track-thumb-wrap").addEventListener("click", e => {
            if (e.target.closest(".heart-btn")) return;
            playFromSearchResult(i, tracks);
        });
        el.querySelector(".track-menu-btn").addEventListener("click", e => {
            e.stopPropagation();
            showContextMenu(e, t);
        });
        el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); playFromSearchResult(i, tracks); } });
        trackList.appendChild(el);
    });

    // Batch-check likes
    const ids = tracks.map(t => t.youtube_id).filter(Boolean);
    loadLikedStatus(ids).then(() => {
        trackList.querySelectorAll(".heart-btn").forEach(btn => {
            const id = btn.dataset.ytid;
            if (id && likedCache[id]) setHeartState(btn, true);
        });
    });
}

// Heart helpers â€” batch check to avoid 40+ individual API calls
let likedCache = {};  // youtube_id -> boolean

async function loadLikedStatus(ids) {
    if (!ids || ids.length === 0) return;
    // Filter out IDs we already know
    const unknown = ids.filter(id => !(id in likedCache));
    if (unknown.length > 0) {
        try {
            const r = await fetch("/api/likes/check-batch", {
                method: "POST", headers: {"Content-Type": "application/json"},
                body: JSON.stringify({ids: unknown}),
            });
            const d = await r.json();
            Object.assign(likedCache, d.results || {});
        } catch {}
    }
}

function checkAndSetHeart(btn, ytId) {
    if (ytId in likedCache) {
        setHeartState(btn, likedCache[ytId]);
    }
    // If not in cache yet, leave as unliked (batch will update later)
}

function setHeartState(btn, liked) {
    btn.querySelector(".heart-empty").classList.toggle("hidden", liked);
    btn.querySelector(".heart-filled").classList.toggle("hidden", !liked);
    btn.classList.toggle("liked", liked);
}

async function toggleLikeWithHeart(btn, track) {
    try {
        const r = await fetch("/api/likes", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify(track),
        });
        const d = await r.json();
        likedCache[track.youtube_id] = d.liked;
        setHeartState(btn, d.liked);
        showToast(d.liked ? "Added to Liked Songs" : "Removed from Liked Songs");
    } catch {}
}

// â”€â”€ Utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmt(s) { if (!s || isNaN(s)) return "0:00"; return Math.floor(s / 60) + ":" + Math.floor(s % 60).toString().padStart(2, "0"); }
function esc(t) { if (!t) return ""; const d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
function setPlayerImage(url) {
    const placeholder = qs("#playerArtPlaceholder");
    if (url) {
        playerImage.src = url;
        playerImage.classList.remove("hidden");
        if (placeholder) placeholder.classList.add("hidden");
    } else {
        playerImage.classList.add("hidden");
        playerImage.removeAttribute("src");
        if (placeholder) placeholder.classList.remove("hidden");
    }
}
function hideAll() {
    contentArea.classList.add("hidden"); trackList.classList.add("hidden");
    homeFeed.classList.add("hidden"); exploreGrid.classList.add("hidden");
    upNextPanel.classList.add("hidden"); settingsView.classList.add("hidden");
}
function showBadge() { sourceBadge.classList.remove("hidden"); sourceBadge.className = "source-badge youtube"; sourceBadge.textContent = "YouTube"; }

// â”€â”€ Context Menu (YT Music style) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let activeMenu = null;

function showContextMenu(event, track) {
    closeContextMenu();
    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.innerHTML =
        '<button class="ctx-item" data-action="playnext">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>' +
        '<span>Play next</span></button>' +

        '<button class="ctx-item" data-action="addqueue">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>' +
        '<span>Add to queue</span></button>' +

        '<div class="ctx-divider"></div>' +

        '<button class="ctx-item" data-action="like">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
        '<span>Like</span></button>' +

        '<button class="ctx-item" data-action="saveplaylist">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M14 10H2v2h12v-2zm0-4H2v2h12V6zM2 16h8v-2H2v2zm19-5V7h-2v4h-4v2h4v4h2v-4h4v-2h-4z"/></svg>' +
        '<span>Save to playlist</span></button>' +

        '<div class="ctx-divider"></div>' +

        '<button class="ctx-item" data-action="radio">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3.24 6.15C2.51 6.43 2 7.17 2 8v12c0 1.1.89 2 2 2h16c1.11 0 2-.9 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34-.37-.92L3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z"/></svg>' +
        '<span>Start radio</span></button>' +

        '<button class="ctx-item" data-action="share">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg>' +
        '<span>Share</span></button>';

    // Bind actions
    menu.querySelector('[data-action="playnext"]').addEventListener("click", () => { playNextInQueue(track); closeContextMenu(); });
    menu.querySelector('[data-action="addqueue"]').addEventListener("click", () => { addToQueue(track); closeContextMenu(); });
    menu.querySelector('[data-action="like"]').addEventListener("click", () => { toggleLike(track); closeContextMenu(); });
    menu.querySelector('[data-action="saveplaylist"]').addEventListener("click", () => { showPlaylistPicker(track); closeContextMenu(); });
    menu.querySelector('[data-action="radio"]').addEventListener("click", () => { startRadio(track); closeContextMenu(); });
    menu.querySelector('[data-action="share"]').addEventListener("click", () => { shareTrack(track); closeContextMenu(); });

    // Check if already liked and update icon
    fetch("/api/likes/check/" + track.youtube_id).then(r => r.json()).then(d => {
        if (d.liked) {
            const likeBtn = menu.querySelector('[data-action="like"]');
            if (likeBtn) {
                likeBtn.querySelector("svg").style.color = "var(--red)";
                likeBtn.querySelector("span").textContent = "Unlike";
            }
        }
    }).catch(() => {});

    const rect = event.target.closest("button").getBoundingClientRect();
    menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - 280) + "px";
    menu.style.left = Math.min(rect.left, window.innerWidth - 200) + "px";

    document.body.appendChild(menu);
    activeMenu = menu;
    setTimeout(() => document.addEventListener("click", closeContextMenu, { once: true }), 10);
}

function closeContextMenu() {
    if (activeMenu) { activeMenu.remove(); activeMenu = null; }
}

async function toggleLike(track) {
    try {
        const r = await fetch("/api/likes", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify(track),
        });
        const d = await r.json();
        showToast(d.liked ? "Added to Liked Songs â¤ï¸" : "Removed from Liked Songs");
    } catch {}
}

function startRadio(track) {
    manualQueue = [];
    autoQueue = [];
    showToast("Starting radio for " + track.title);
    playTrackNow(track);
}

function shareTrack(track) {
    const url = "https://music.youtube.com/watch?v=" + track.youtube_id;
    if (navigator.share) {
        navigator.share({ title: track.title, text: track.title + " - " + track.artist, url: url });
    } else {
        navigator.clipboard.writeText(url).then(() => showToast("Link copied!")).catch(() => showToast("Could not copy"));
    }
}

// â”€â”€ Toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function showToast(msg) {
    const existing = qs(".toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("show"), 10);
    setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 300); }, 2000);
}

// â”€â”€ Playlist Picker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function showPlaylistPicker(track) {
    closeContextMenu();
    // Fetch playlists
    let playlists = [];
    try {
        const r = await fetch("/api/playlists");
        const d = await r.json();
        playlists = d.playlists || [];
    } catch {}

    // Create modal
    const overlay = document.createElement("div");
    overlay.className = "pl-picker-overlay";
    let listHtml = "";
    playlists.forEach(pl => {
        listHtml += '<button class="pl-pick-item" data-plid="' + pl.id + '">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>' +
            '<span>' + esc(pl.name) + ' (' + pl.tracks.length + ')</span></button>';
    });

    overlay.innerHTML =
        '<div class="pl-picker">' +
        '<div class="pl-picker-hdr"><h3>Save to playlist</h3>' +
        '<button class="pl-picker-close" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button></div>' +
        '<div class="pl-pick-new"><input type="text" id="plNewName" placeholder="New playlist name..."><button class="btn-primary" id="plCreateBtn">Create</button></div>' +
        '<div class="pl-pick-list">' + (listHtml || '<p style="color:var(--text-muted);font-size:12px;padding:12px">No playlists yet</p>') + '</div>' +
        '</div>';

    document.body.appendChild(overlay);

    // Close
    overlay.querySelector(".pl-picker-close").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });

    // Create new playlist
    overlay.querySelector("#plCreateBtn").addEventListener("click", async () => {
        const name = overlay.querySelector("#plNewName").value.trim();
        if (!name) return;
        try {
            const r = await fetch("/api/playlists", {
                method: "POST", headers: {"Content-Type": "application/json"},
                body: JSON.stringify({name: name}),
            });
            const d = await r.json();
            if (d.ok && d.playlist) {
                // Add track to the new playlist
                await fetch("/api/playlists/" + d.playlist.id + "/tracks", {
                    method: "POST", headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(track),
                });
                showToast("Saved to " + name);
                overlay.remove();
            }
        } catch {}
    });

    // Add to existing playlist
    overlay.querySelectorAll(".pl-pick-item").forEach(btn => {
        btn.addEventListener("click", async () => {
            const plid = btn.dataset.plid;
            try {
                await fetch("/api/playlists/" + plid + "/tracks", {
                    method: "POST", headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(track),
                });
                showToast("Saved to playlist");
                overlay.remove();
            } catch {}
        });
    });
}

// â”€â”€ Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

qs("#settingsBtn").addEventListener("click", () => handleNav("settings"));

async function showSettings() {
    hideAll(); filterChips.classList.add("hidden"); sourceBadge.classList.add("hidden");
    settingsView.classList.remove("hidden");

    // Show current preferences status
    try {
        const r = await fetch("/api/preferences");
        const d = await r.json();
        const statusEl = qs("#prefsStatusText");
        if (d.preferences && d.preferences.setup_done) {
            const langs = (d.preferences.languages || []).join(", ");
            const artists = (d.preferences.artists || []).map(a => a.name).join(", ");
            statusEl.textContent = "Languages: " + (langs || "None") + " | Artists: " + (artists || "None");
        } else {
            statusEl.textContent = "No preferences set yet";
        }
    } catch {}
}

qs("#editPrefsBtn").addEventListener("click", () => {
    // Re-show onboarding to edit preferences
    showOnboarding();
});

// â”€â”€ Keyboard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT") return;
    switch (e.code) {
        case "Space": e.preventDefault(); if (nowPlaying) { if (isPlaying) { audio.pause(); setPlay(false); } else { audio.play(); setPlay(true); } } break;
        case "ArrowRight": playNext(); break;
        case "ArrowLeft": playPrev(); break;
        case "KeyM": volumeBtn.click(); break;
    }
});
document.addEventListener("keydown", e => {
    if ((e.ctrlKey && e.key === "k") || (e.key === "/" && e.target.tagName !== "INPUT")) { e.preventDefault(); searchInput.focus(); }
});


// â”€â”€ PWA Service Worker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/static/sw.js').catch(() => {});
}

import { useState, useEffect } from 'react'

function SocialWidget() {
  // YouTube Media Terminal states. Two previously hardcoded defaults here
  // (21X5lGlDOfg, then jfKfPfyJRdk) have each in turn gone dead — both were 24/7 livestreams,
  // and those periodically end and get replaced with a new video ID on YouTube's side, so any
  // livestream hardcoded as a "default" is guaranteed to rot again eventually. Defaulting to
  // empty instead — no video until the user mounts one themselves — has no such expiry.
  const STALE_DEFAULT_YT_URLS = [
    'https://www.youtube.com/watch?v=21X5lGlDOfg',
    'https://www.youtube.com/watch?v=jfKfPfyJRdk',
  ]
  const [ytUrl, setYtUrl] = useState(() => {
    const saved = localStorage.getItem('dashboardYtUrl')
    if (STALE_DEFAULT_YT_URLS.includes(saved)) return ''
    return saved || ''
  })
  const [tempYtUrl, setTempYtUrl] = useState(ytUrl)
  const [isYtLocked, setIsYtLocked] = useState(() => {
    const saved = localStorage.getItem('dashboardYtLocked')
    return saved ? JSON.parse(saved) : false
  })
  const [useDefaultYt, setUseDefaultYt] = useState(() => {
    const saved = localStorage.getItem('dashboardUseDefaultYt')
    return saved ? JSON.parse(saved) : false
  })
  const [defaultYtUrl, setDefaultYtUrl] = useState(() => {
    const saved = localStorage.getItem('dashboardYtDefaultUrl')
    if (STALE_DEFAULT_YT_URLS.includes(saved)) return ''
    return saved || ''
  })
  const [tempDefaultYtUrl, setTempDefaultYtUrl] = useState(defaultYtUrl)
  const [showDftConfig, setShowDftConfig] = useState(false)

  // Persists standard configurations
  useEffect(() => {
    localStorage.setItem('dashboardYtLocked', JSON.stringify(isYtLocked))
  }, [isYtLocked])

  useEffect(() => {
    localStorage.setItem('dashboardUseDefaultYt', JSON.stringify(useDefaultYt))
  }, [useDefaultYt])

  useEffect(() => {
    localStorage.setItem('dashboardYtDefaultUrl', defaultYtUrl)
  }, [defaultYtUrl])

  useEffect(() => {
    localStorage.setItem('dashboardYtUrl', ytUrl)
  }, [ytUrl])

  const getYoutubeEmbedUrl = (url) => {
    if (!url) return ''
    // Passing `origin` explicitly is YouTube's own documented workaround for exactly this
    // situation: WKWebView (this app's production runtime) doesn't reliably send a Referer
    // header for the embedding page, which YouTube's player otherwise falls back on to
    // verify where it's being embedded from — without it, playback can fail even for
    // videos with no actual embedding restriction. `window.location.origin` here is
    // `http://127.0.0.1:47420` in production (see src-tauri/src/lib.rs) or the Vite dev
    // server's origin in development, matching whatever page is really hosting the iframe.
    const origin = encodeURIComponent(window.location.origin)
    const baseParams = `?autoplay=1&origin=${origin}`
    const playlistMatch = url.match(/[&?]list=([^&]+)/)
    if (playlistMatch) {
      return `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistMatch[1]}&autoplay=1&origin=${origin}`
    }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/
    const match = url.match(regExp)
    if (match && match[2].length === 11) {
      return `https://www.youtube-nocookie.com/embed/${match[2]}${baseParams}`
    }
    const trimmed = url.trim()
    if (trimmed.length === 11) {
      return `https://www.youtube-nocookie.com/embed/${trimmed}${baseParams}`
    }
    return ''
  }

  const handleMountUrl = () => {
    setYtUrl(tempYtUrl)
  }

  // useDefaultYt previously fell back to its own separately-hardcoded (and equally stale)
  // video ID here instead of the user-configurable defaultYtUrl set via SET_DFT below —
  // using that state directly instead fixes the disconnect as well as the staleness.
  const targetUrlEvaluated = useDefaultYt ? defaultYtUrl : ytUrl
  const activeEmbedUrl = getYoutubeEmbedUrl(targetUrlEvaluated)

  return (
    <div className="p-4 flex-grow flex flex-col justify-start gap-y-3 overflow-hidden text-sm font-sans">
      <div className="select-none flex gap-1.5 border-b border-[#1c3547]/40 pb-2">
        <input
          type="text"
          placeholder="PASTE YT VIDEO/PLAYLIST URL OR ID..."
          value={tempYtUrl}
          onChange={(e) => setTempYtUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleMountUrl()}
          className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-xs px-3 py-1.5 rounded focus:outline-none focus:border-[#00d2ff] flex-grow font-sans"
        />
        <button
          onClick={handleMountUrl}
          className="bg-[#132533] hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 text-xs px-3 rounded font-bold transition-all cursor-pointer font-sans"
        >
          MOUNT
        </button>
      </div>

      {showDftConfig && (
        <div className="select-none flex gap-1.5 border-b border-[#1c3547]/40 pb-2 transition-all duration-300">
          <input
            type="text"
            placeholder="SET DEFAULT YT URL..."
            value={tempDefaultYtUrl}
            onChange={(e) => setTempDefaultYtUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setDefaultYtUrl(tempDefaultYtUrl)}
            className="bg-[#090e14] border border-[#1c3547] text-[#60809a] text-xs px-3 py-1.5 rounded focus:outline-none focus:border-[#d07018] flex-grow font-sans"
          />
          <button
            onClick={() => setDefaultYtUrl(tempDefaultYtUrl)}
            className="bg-[#132533] hover:bg-[#1c3547] active:bg-[#d07018] active:text-black border border-[#1c3547] text-[#d07018] text-xs px-3 rounded font-bold transition-all cursor-pointer"
          >
            SET_DFT
          </button>
        </div>
      )}

      <div className="flex-grow overflow-hidden rounded bg-black/30 h-full w-full">
        {activeEmbedUrl ? (
          <iframe
            key={activeEmbedUrl}
            className={`w-full h-full border-0 transition-all ${
              isYtLocked ? 'pointer-events-none' : ''
            }`}
            src={activeEmbedUrl}
            title="YouTube Dashboard Node"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          ></iframe>
        ) : (
          <div className="text-xs text-cyan-700 italic select-none py-6 text-center">
            INVALID_YOUTUBE_URL_OR_ID_NODE
          </div>
        )}
      </div>
    </div>
  )
}

export default SocialWidget

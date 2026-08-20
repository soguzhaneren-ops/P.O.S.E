import { useState, useEffect } from 'react'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

function NewsWidget({ onLoadingChange }) {
  const [newsCategory, setNewsCategory] = useState('LOCAL')
  const [displayCategory, setDisplayCategory] = useState('LOCAL')
  const [isFadingOut, setIsFadingOut] = useState(false)
  const [animateNews, setAnimateNews] = useState(true)
  const [news, setNews] = useState({
    items: [],
    loading: true,
    error: false
  })
  const [lastManualClick, setLastManualClick] = useState(() => Date.now())

  useEffect(() => {
    if (onLoadingChange) onLoadingChange(news.loading)
  }, [news.loading])

  useEffect(() => {
    const fetchNewsFeed = () => {
      setNews(prev => ({ ...prev, loading: true, error: false }))
      let targetFeedUrl = ''
      let sourceName = ''

      if (newsCategory === 'LOCAL') {
        targetFeedUrl = 'http://feeds.bbci.co.uk/turkce/rss.xml'
        sourceName = 'BBC TÜRKÇE'
      } else if (newsCategory === 'FINANCE') {
        targetFeedUrl = 'https://finance.yahoo.com/news/rssindex'
        sourceName = 'YAHOO'
      } else if (newsCategory === 'POLITICS') {
        targetFeedUrl = 'http://feeds.bbci.co.uk/news/politics/rss.xml'
        sourceName = 'BBC POLITICS'
      }

      tauriFetch(targetFeedUrl)
        .then(res => {
          if (!res.ok) throw new Error()
          return res.text()
        })
        .then(xmlText => {
          let parsedArticles = []
          try {
            const parser = new DOMParser()
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml')
            const parserError = xmlDoc.getElementsByTagName('parsererror')
            if (parserError.length > 0) throw new Error()

            const rssItems = xmlDoc.getElementsByTagName('item')
            for (let i = 0; i < Math.min(rssItems.length, 5); i++) {
              const title = rssItems[i].getElementsByTagName('title')[0]?.textContent || 'UNTITLED_LOG'
              const link = rssItems[i].getElementsByTagName('link')[0]?.textContent || '#'
              parsedArticles.push({ title, link, source: sourceName })
            }
          } catch {
            const itemBlocks = xmlText.match(/<item>([\s\S]*?)<\/item>/g) || []
            for (let i = 0; i < Math.min(itemBlocks.length, 5); i++) {
              const titleMatch = itemBlocks[i].match(/<title>(<!\[CDATA\[)?([\s\S]*?)(]]>)?<\/title>/)
              const linkMatch = itemBlocks[i].match(/<link>([\s\S]*?)<\/link>/)
              let title = 'UNTITLED_LOG'
              if (titleMatch) {
                title = titleMatch[2]
                  .replace(/<!\[CDATA\[|]]>/g, '')
                  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
                  .trim()
              }
              const link = linkMatch ? linkMatch[1].trim() : '#'
              parsedArticles.push({ title, link, source: sourceName })
            }
          }
          if (parsedArticles.length === 0) throw new Error()
          setNews({ items: parsedArticles, loading: false, error: false })
        })
        .catch(() => {
          setNews({ items: [], loading: false, error: true })
        })
    }

    fetchNewsFeed()
    const newsInterval = setInterval(fetchNewsFeed, 60000)
    return () => clearInterval(newsInterval)
  }, [newsCategory])

  useEffect(() => {
    if (!news.loading) {
      setIsFadingOut(false)
      setAnimateNews(true)
    }
  }, [news.loading])

  useEffect(() => {
    const timeSinceClick = Date.now() - lastManualClick
    const delayUntilAutoCycle = Math.max(0, 20000 - timeSinceClick)
    let cycleInterval

    const startAutoCycleTimeout = setTimeout(() => {
      cycleInterval = setInterval(() => {
        setIsFadingOut(true)
        setTimeout(() => {
          setNewsCategory(current => {
            const next = current === 'LOCAL' ? 'FINANCE' : current === 'FINANCE' ? 'POLITICS' : 'LOCAL'
            setDisplayCategory(next)
            return next
          })
        }, 550)
      }, 6000)
    }, delayUntilAutoCycle)

    return () => {
      clearTimeout(startAutoCycleTimeout)
      if (cycleInterval) clearInterval(cycleInterval)
    }
  }, [lastManualClick])

  const handleManualCategoryChange = (category) => {
    if (category === displayCategory) return
    setLastManualClick(Date.now())
    setAnimateNews(false)
    setIsFadingOut(false)
    setNewsCategory(category)
    setDisplayCategory(category)
  }

  const isContentHidden = animateNews ? (news.loading || isFadingOut) : false

  return (
    <div className="p-4 flex-grow flex flex-col justify-start gap-y-4 overflow-hidden font-sans">
      <div className="flex gap-2 select-none border-b border-[#1c3547]/40 pb-2 text-xs font-bold">
        <button
          onClick={() => handleManualCategoryChange('LOCAL')}
          className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
            displayCategory === 'LOCAL'
              ? 'bg-[#d07018] text-black border-[#d07018]'
              : 'border-[#1c3547] text-[#60809a] hover:text-cyan-400'
          }`}
        >
          [ LOCAL ]
        </button>
        <button
          onClick={() => handleManualCategoryChange('FINANCE')}
          className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
            displayCategory === 'FINANCE'
              ? 'bg-[#d07018] text-black border-[#d07018]'
              : 'border-[#1c3547] text-[#60809a] hover:text-cyan-400'
          }`}
        >
          [ FINANCE ]
        </button>
        <button
          onClick={() => handleManualCategoryChange('POLITICS')}
          className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
            displayCategory === 'POLITICS'
              ? 'bg-[#d07018] text-black border-[#d07018]'
              : 'border-[#1c3547] text-[#60809a] hover:text-cyan-400'
          }`}
        >
          [ POLITICS ]
        </button>
      </div>

      <div className="flex-grow overflow-auto pr-1">
        <div className={`transition-all ${
          animateNews ? 'duration-700 ease-in-out' : 'duration-0'
        } ${
          isContentHidden ? 'opacity-0 scale-98' : 'opacity-100 scale-100'
        }`}>
          {news.error ? (
            <div className="text-sm text-rose-500 font-bold py-8 text-center select-none animate-pulse">
              LNK_ERR // UNABLE_TO_FETCH_FEED
            </div>
          ) : (
            <ul className="space-y-4">
              {news.items.map((item, index) => (
                <li key={index} className="border-l-2 border-cyan-500/40 pl-3 py-0.5 hover:border-cyan-400 transition-colors duration-150">
                  <a href={item.link} target="_blank" rel="noopener noreferrer" className="block focus:outline-none">
                    <div className="text-xs text-[#60809a] mb-1 select-none uppercase tracking-wider font-bold">
                      SOURCE: {item.source}
                    </div>
                    <h3 className="text-sm lg:text-base font-bold text-cyan-100 hover:underline leading-snug tracking-tight">
                      {item.title}
                    </h3>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default NewsWidget
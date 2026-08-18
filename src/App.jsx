import * as math from 'mathjs'
import React, { useState, useEffect, useRef } from 'react'
import { WidthProvider, Responsive as ResponsiveGridLayout } from 'react-grid-layout/legacy'
import WidgetShell from './components/WidgetShell'
import WeatherWidget from './widgets/WeatherWidget'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { getCurrentWindow } from '@tauri-apps/api/window' 
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

const ResponsiveReactGridLayout = WidthProvider(ResponsiveGridLayout)

// Load secure API key from local environment configuration
const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_API_KEY;

// Base grid configuration layouts (Using dynamic columns, supporting responsive grid points)
const defaultLayouts = {
  lg: [
    { i: 'weather', x: 0, y: 0, w: 3, h: 7, minW: 2, minH: 3 },
    { i: 'market', x: 0, y: 7, w: 3, h: 5, minW: 2, minH: 4 },
    { i: 'social',  x: 3, y: 0, w: 3, h: 6, minW: 2, minH: 3 },
    { i: 'news',   x: 3, y: 6, w: 3, h: 5, minW: 2, minH: 4 },
    { i: 'main',   x: 6, y: 0, w: 6, h: 12, minW: 4, minH: 6 },
    { i: 'todo',   x: 3, y: 11, w: 3, h: 4, minW: 2, minH: 3 },
    { i: 'calculator', x: 0, y: 12, w: 12, h: 8, minW: 4, minH: 5 }
  ],
  md: [
    { i: 'weather', x: 0, y: 0, w: 6, h: 7, minW: 2, minH: 3 },
    { i: 'market', x: 6, y: 0, w: 6, h: 5, minW: 2, minH: 4 },
    { i: 'main',   x: 0, y: 7, w: 12, h: 9, minW: 4, minH: 6 },
    { i: 'news',   x: 0, y: 16, w: 6, h: 7, minW: 2, minH: 4 },
    { i: 'social', x: 6, y: 16, w: 6, h: 5, minW: 2, minH: 3 },
    { i: 'todo',   x: 0, y: 21, w: 6, h: 4, minW: 2, minH: 3 },
    { i: 'calculator', x: 6, y: 21, w: 6, h: 8, minW: 4, minH: 5 }
  ]
}

function App() {
  
  const toggleFullscreen = async () => {
    const win = getCurrentWindow()
    const isFs = await win.isFullscreen()
    await win.setFullscreen(!isFs)
  }
  const [weatherLoading, setWeatherLoading] = useState(true)
  const [graphScale, setGraphScale] = useState(32)
  
  // Starred market symbols
  const [starredSymbols, setStarredSymbols] = useState(() => {
    const saved = localStorage.getItem('starredSymbols')
    return saved ? JSON.parse(saved) : ['TSLA', 'AAPL', 'MSFT', 'NVDA']
  })

  // Active Portfolio holdings state
  const [holdings, setHoldings] = useState(() => {
    const saved = localStorage.getItem('dashboardHoldings')
    return saved ? JSON.parse(saved) : [
      { symbol: 'TSLA', qty: 10, cost: 280.50 },
      { symbol: 'AAPL', qty: 15, cost: 185.20 }
    ]
  })

  // Live market data
  const [marketData, setMarketData] = useState({})
  const [marketLoading, setMarketLoading] = useState(true)

  // Watchlist Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchError, setSearchError] = useState('')

  // Portfolio Input states
  const [portTicker, setPortTicker] = useState('')
  const [portQty, setPortQty] = useState('')
  const [portPrice, setPortPrice] = useState('')
  const [portError, setPortError] = useState('')

  const [sellTicker, setSellTicker] = useState('')
  const [sellQty, setSellQty] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [sellError, setSellError] = useState('')
  const [portfolioMode, setPortfolioMode] = useState('buy') // 'buy' or 'sell'

  // Track the active breakpoint to safely resolve dropping coordinates
  const [currentBreakpoint, setCurrentBreakpoint] = useState('lg')

  // Interactive layout grid state with sanitizer
  const [layouts, setLayouts] = useState(() => {
    const saved = localStorage.getItem('dashboardLayouts')
    const parsed = saved ? JSON.parse(saved) : defaultLayouts

    const sanitizeLayout = (layoutList, breakpoint) => {
      let updatedList = layoutList.map(item => {
        if (item.i === 'weather') {
          return { ...item, minH: 2, minW: 2 }
        }
        return item
      })

      if (!updatedList.some(item => item.i === 'todo')) {
        const defaultTodo = defaultLayouts[breakpoint].find(item => item.i === 'todo')
        if (defaultTodo) updatedList.push(defaultTodo)
      }

      if (!updatedList.some(item => item.i === 'calculator')) {
        const defaultCalc = defaultLayouts[breakpoint].find(item => item.i === 'calculator')
        if (defaultCalc) updatedList.push(defaultCalc)
      }

      return updatedList
    }

    if (parsed.lg) parsed.lg = sanitizeLayout(parsed.lg, 'lg')
    if (parsed.md) parsed.md = sanitizeLayout(parsed.md, 'md')

    return parsed
  })

  // Tabbed News State
  const [newsCategory, setNewsCategory] = useState('LOCAL')
  const [displayCategory, setDisplayCategory] = useState('LOCAL')
  const [isFadingOut, setIsFadingOut] = useState(false)
  const [animateNews, setAnimateNews] = useState(true)
  const [news, setNews] = useState({
    items: [],
    loading: true,
    error: false
  })

  // Tabbed Financial Feed Transition States
  const [marketCategory, setMarketCategory] = useState('WATCHLIST')
  const [displayMarketTab, setDisplayMarketTab] = useState('WATCHLIST')
  const [isMarketFadingOut, setIsMarketFadingOut] = useState(false)
  const [animateMarket, setAnimateMarket] = useState(true)
  const [lastManualMarketClick, setLastManualMarketClick] = useState(() => Date.now())

  // Dynamic To-Do List state (Supports sorting and double-click edits)
  const [todos, setTodos] = useState(() => {
    const saved = localStorage.getItem('dashboardTodos')
    const parsed = saved ? JSON.parse(saved) : [
      { id: 1, text: 'SYS_BOOT: VERIFY PORTFOLIO INTEGRITY', completed: true, subTasks: [] },
      { id: 2, text: 'UPGRADE: SECURE TELEMETRY NODES', completed: false, subTasks: [
        { id: 21, text: 'VERIFY FINNHUB HANDSHAKE', completed: false },
        { id: 22, text: 'OPTIMIZE COMPILER CHANNELS', completed: true }
      ]}
    ]
    return parsed
  })
  const [newTodo, setNewTodo] = useState('')
  const [expandedTodos, setExpandedTodos] = useState([])
  const [subTaskInputs, setSubTaskInputs] = useState({})

  // States for To-Do drag-and-drop sorting & inline editing
  const [draggedTodoId, setDraggedTodoId] = useState(null)
  const [editingTodoId, setEditingTodoId] = useState(null)
  const [editingTodoValue, setEditingTodoValue] = useState('')

  // State maps for Slide-Up Bottom Drawer docking panel
  const [dockedWidgets, setDockedWidgets] = useState(() => {
    const saved = localStorage.getItem('dashboardDocked')
    return saved ? JSON.parse(saved) : []
  })
  const [lastCoordinates, setLastCoordinates] = useState(() => {
    const saved = localStorage.getItem('dashboardLastCoords')
    return saved ? JSON.parse(saved) : {}
  })
  const [isDockOpen, setIsDockOpen] = useState(false)
  const [activeDragId, setActiveDragId] = useState(null)
  const [previewDockingId, setPreviewDockingId] = useState(null)

  // State-driven Focal Diagnostic isolation controllers [3]
  const [focalWidgetId, setFocalWidgetId] = useState(null)
  const [isClosingFocal, setIsClosingFocal] = useState(false)

  // Handle smooth exiting transition for Focal Diagnostic Isolation Mode [3]
  const handleCloseFocal = () => {
    setIsClosingFocal(true)
    setTimeout(() => {
      setFocalWidgetId(null)
      setIsClosingFocal(false)
    }, 280) // Closes exactly as the exit keyframe finishes [3]
  }
  // Binds physical keyboard shortcuts: "O" to Zoom In, "P" to Zoom Out, "Esc" to exit Focus Mode [1]
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeEl = document.activeElement
      const isEditingInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')

      if (e.key === 'Escape') {
        if (isEditingInput) {
          // Allow inline text editing fields to capture Escape first to cancel text inputs
          return
        }
        handleCloseFocal() // Triggers smooth zoom-out exit transition
      }

      if (isEditingInput) return

      if (e.key.toLowerCase() === 'o') {
        setGraphScale(prev => Math.min(128, prev * 1.25))
      } else if (e.key.toLowerCase() === 'p') {
        setGraphScale(prev => Math.max(8, prev / 1.25))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focalWidgetId, isClosingFocal, handleCloseFocal])

  // Sizing parameters for elements dragged out of storage back onto grid
  const [droppingWidgetId, setDroppingWidgetId] = useState(null)
  const [droppingW, setDroppingW] = useState(3)
  const [droppingH, setDroppingH] = useState(4)

  // YouTube Media Terminal states
  const [ytUrl, setYtUrl] = useState(() => {
    const saved = localStorage.getItem('dashboardYtUrl')
    if (saved === 'https://www.youtube.com/watch?v=21X5lGlDOfg') {
      return 'https://www.youtube.com/watch?v=jfKfPfyJRdk'
    }
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
    return localStorage.getItem('dashboardYtDefaultUrl') || 'https://www.youtube.com/watch?v=jfKfPfyJRdk'
  })
  const [tempDefaultYtUrl, setTempDefaultYtUrl] = useState(defaultYtUrl)
  const [showDftConfig, setShowDftConfig] = useState(false)

  // Math Formatting regex parser
  const formatMathToJSX = (expr) => {
    if (!expr) return ''
    let html = expr.replace(/\*/g, '') 
    html = html.replace(/([0-9a-zA-Z\s()]+)\/([0-9a-zA-Z\s()]+)/g, 
      '<span class="inline-flex flex-col justify-center items-center align-middle text-center leading-none text-[0.5rem] ml-0.5 mr-0.5"><span class="border-b border-current pb-[2px] pl-0.5 pr-0.5">$1</span><span class="pt-[2px] pl-0.5 pr-0.5">$2</span></span>'
    )
    html = html
      .replace(/\^([0-9a-zA-Z/+-]+)/g, '<sup class="font-bold text-[0.5rem]">$1</sup>')
      .replace(/\^\(([^)]+)\)/g, '<sup class="font-bold text-[0.5rem]">$1</sup>')
      .replace(/log\(/g, '<span class="font-sans font-normal opacity-85">log</span>(')
      .replace(/ln\(/g, '<span class="font-sans font-normal opacity-85">ln</span>(')
      .replace(/sin\(/g, '<span class="font-sans font-normal opacity-85">sin</span>(')
      .replace(/cos\(/g, '<span class="font-sans font-normal opacity-85">cos</span>(')
      .replace(/sqrt\(/g, '<span class="font-sans font-normal opacity-85">√</span>(')

    html = html.replace(/(?<![a-zA-Z])(x|y)(?![a-zA-Z])/g, '<i class="font-serif italic font-normal">$1</i>')
    return <span dangerouslySetInnerHTML={{ __html: html }} className="font-sans tracking-wide" />
  }
  
  // 2D graphing system state
  const [equations, setEquations] = useState(() => {
    const saved = localStorage.getItem('dashboardCalcEqs')
    return saved ? JSON.parse(saved) : ['x^2 + y^2 = 9', 'y = log(x)']
  })
  const [newEqInput, setNewEqInput] = useState('')
  const canvasRef = useRef(null)

  const [graphCenter, setGraphCenter] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  const [searchPointInput, setSearchPointInput] = useState('')
  const [searchedPoints, setSearchedPoints] = useState([])
  const [showExtremaFinder, setShowExtremaFinder] = useState(false)
  const [extremaEq, setExtremaEq] = useState('')
  const [domainMin, setDomainMin] = useState('')
  const [domainMax, setDomainMax] = useState('')
  const [extremaType, setExtremaType] = useState('MAX')
  const [resolvedExtrema, setResolvedExtrema] = useState(null)

  const [editingIndex, setEditingIndex] = useState(null)
  const [editingValue, setEditingValue] = useState('')

  // Sync graphing equations to storage
  useEffect(() => {
    localStorage.setItem('dashboardCalcEqs', JSON.stringify(equations))
  }, [equations])

  // Drag-to-pan handlers
  const handleCanvasMouseDown = (e) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY })
  }

  const handleCanvasMouseMove = (e) => {
    if (!isDragging) return
    const dx = e.clientX - dragStart.x
    const dy = e.clientY - dragStart.y
    setGraphCenter(prev => ({
      x: prev.x - dx / graphScale,
      y: prev.y + dy / graphScale
    }))
    setDragStart({ x: e.clientX, y: e.clientY })
  }

  const handleCanvasMouseUp = () => {
    setIsDragging(false)
  }

  const compileEquationToFn = (eqStr) => {
    let normalized = eqStr
      .replace(/√\s*\(([^)]+)\)/g, 'sqrt($1)')
      .replace(/√\s*([a-zA-Z0-9.]+)/g, 'sqrt($1)')
      .replace(/\bln\(/g, 'log(')
      .replace(/\^1\/2/g, '^0.5')
      .replace(/\^\(1\/2\)/g, '^0.5')

    let leftSide = normalized
    let rightSide = '0'

    if (normalized.includes('=')) {
      const parts = normalized.split('=')
      leftSide = parts[0].trim()
      rightSide = parts[1].trim()
    } else {
      if (!normalized.includes('y')) {
        leftSide = 'y'
        rightSide = `(${normalized})`
      }
    }
    return math.compile(`(${leftSide}) - (${rightSide})`)
  }

  const handleAddEquation = () => {
    const clean = newEqInput.trim().toLowerCase()
    if (!clean) return
    try {
      compileEquationToFn(clean)
      setEquations(prev => [...prev, clean])
      setNewEqInput('')
    } catch {
      alert('SYNTAX_ERROR: Unable to parse equation structure.')
    }
  }

  const handleRemoveEquation = (indexToRemove) => {
    setEquations(prev => prev.filter((_, idx) => idx !== indexToRemove))
  }
  
  const handleSearchPoint = () => {
    let query = searchPointInput.trim().toLowerCase()
    if (!query) return

    query = query
      .replace(/√\s*\(([^)]+)\)/g, 'sqrt($1)')
      .replace(/√\s*([a-zA-Z0-9.]+)/g, 'sqrt($1)')
      .replace(/\bln\(/g, 'log(')
      .replace(/\^1\/2/g, '^0.5')
      .replace(/\^\(1\/2\)/g, '^0.5')

    if (query.startsWith('x=')) {
      const rightSide = query.split('=')[1].trim()
      try {
        const val = parseFloat(math.evaluate(rightSide))
        if (isNaN(val) || !isFinite(val)) throw new Error()
        setSearchedPoints(prev => [...prev, { type: 'x-line', val }])
        setSearchPointInput('')
        return
      } catch {
        alert('FORMAT_ERROR: Unable to evaluate x-value expression.')
        return
      }
    }

    const pointMatch = query.match(/^\(?\s*([^,]+)\s*,\s*([^,)]+)\s*\)?$/)
    if (pointMatch) {
      try {
        const px = parseFloat(math.evaluate(pointMatch[1].trim()))
        const py = parseFloat(math.evaluate(pointMatch[2].trim()))
        if (isNaN(px) || !isFinite(px) || isNaN(py) || !isFinite(py)) throw new Error()
        setSearchedPoints(prev => [...prev, { type: 'point', x: px, y: py }])
        setSearchPointInput('')
        return
      } catch {
        alert('FORMAT_ERROR: Unable to evaluate coordinate expressions.')
        return
      }
    }
    alert('FORMAT_ERROR: Use "x = 1/2" or "(3, -√2)"')
  }

  const handleClearPoints = () => {
    setSearchedPoints([])
  }

  const handleStartEdit = (index, value) => {
    setEditingIndex(index)
    setEditingValue(value)
  }

  const handleSaveEdit = (index) => {
    const clean = editingValue.trim().toLowerCase()
    if (!clean) {
      setEditingIndex(null)
      return
    }
    try {
      compileEquationToFn(clean)
      setEquations(prev => {
        const copy = [...prev]
        copy[index] = clean
        return copy
      })
      setEditingIndex(null)
    } catch {
      alert('SYNTAX_ERROR: Unable to parse edited equation.')
    }
  }

  const handleResolveExtrema = () => {
    if (!extremaEq) return
    const xMin = parseFloat(domainMin)
    const xMax = parseFloat(domainMax)

    if (isNaN(xMin) || isNaN(xMax) || xMin >= xMax) {
      alert('FORMAT_ERROR: Enter valid domain boundaries where x_min < x_max.')
      return
    }

    try {
      let normalized = extremaEq
        .replace(/√\s*\(([^)]+)\)/g, 'sqrt($1)')
        .replace(/√\s*([a-zA-Z0-9.]+)/g, 'sqrt($1)')
        .replace(/\bln\(/g, 'log(')
        .replace(/\^1\/2/g, '^0.5')
        .replace(/\^\(1\/2\)/g, '^0.5')

      let rightSide = normalized
      if (normalized.includes('=')) {
        rightSide = normalized.split('=')[1].trim()
      }
      const compRight = math.compile(rightSide)
      
      const steps = 1000
      const step = (xMax - xMin) / steps
      
      let optX = xMin
      let optY = compRight.evaluate({ x: xMin })

      for (let i = 1; i <= steps; i++) {
        const currentX = xMin + i * step
        const currentY = compRight.evaluate({ x: currentX })
        if (isNaN(currentY) || !isFinite(currentY)) continue
        if (extremaType === 'MAX') {
          if (currentY > optY) {
            optY = currentY
            optX = currentX
          }
        } else {
          if (currentY < optY) {
            optY = currentY
            optX = currentX
          }
        }
      }

      setResolvedExtrema({
        x: optX,
        y: optY,
        type: extremaType
      })
    } catch {
      alert('SOLVE_ERROR: Unable to evaluate mathematical function across domain.')
    }
  }

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

  const [tempText, setTempText] = useState(() => {
    return localStorage.getItem('dashboardTempText') || ''
  })

  const [lastManualClick, setLastManualClick] = useState(() => Date.now())


  // Sync operations
  useEffect(() => {
    localStorage.setItem('starredSymbols', JSON.stringify(starredSymbols))
  }, [starredSymbols])

  useEffect(() => {
    localStorage.setItem('dashboardHoldings', JSON.stringify(holdings))
  }, [holdings])

  useEffect(() => {
    localStorage.setItem('dashboardTodos', JSON.stringify(todos))
  }, [todos])

  useEffect(() => {
    localStorage.setItem('dashboardTempText', tempText)
  }, [tempText])

  useEffect(() => {
    localStorage.setItem('dashboardYtUrl', ytUrl)
  }, [ytUrl])

  useEffect(() => {
    localStorage.setItem('dashboardDocked', JSON.stringify(dockedWidgets))
  }, [dockedWidgets])

  useEffect(() => {
    localStorage.setItem('dashboardLastCoords', JSON.stringify(lastCoordinates))
  }, [lastCoordinates])

  

  const getYoutubeEmbedUrl = (url) => {
    if (!url) return ''
    const baseParams = `?autoplay=1`
    const playlistMatch = url.match(/[&?]list=([^&]+)/)
    if (playlistMatch) {
      return `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistMatch[1]}&autoplay=1`
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

  

  // Stocks data polling
  useEffect(() => {
    const fetchMarketTickers = () => {
      const uniqueQuerySymbols = Array.from(new Set([
        ...starredSymbols,
        ...holdings.map(h => h.symbol)
      ]))

      if (uniqueQuerySymbols.length === 0) {
        setMarketData({})
        setMarketLoading(false)
        return
      }

      const promises = uniqueQuerySymbols.map(sym => {
        const cleanSym = sym.trim().toUpperCase()
        const url = `https://finnhub.io/api/v1/quote?symbol=${cleanSym}&token=${FINNHUB_KEY}`
        return fetch(url)
          .then(res => {
            if (!res.ok) throw new Error()
            return res.json()
          })
          .then(data => ({ sym, data }))
          .catch(() => ({ sym, error: true }))
      })

      Promise.all(promises)
        .then(results => {
          const newData = {}
          results.forEach(({ sym, data, error }) => {
            if (error || !data || data.c === 0 || data.c === null) {
              newData[sym] = { price: 'N/A', change: '0.00%', isPositive: true, error: true }
            } else {
              const priceVal = data.c
              const changeVal = data.dp || 0
              newData[sym] = {
                price: `€${priceVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                change: `${changeVal >= 0 ? '+' : ''}${changeVal.toFixed(2)}%`,
                isPositive: changeVal >= 0
              }
            }
          })
          setMarketData(newData)
          setMarketLoading(false)
        })
        .catch(err => console.error(err))
    }

    fetchMarketTickers()
    const intervalId = setInterval(fetchMarketTickers, 20000)
    return () => clearInterval(intervalId)
  }, [starredSymbols, holdings])

  // RSS Feed parser (BBC Türkçe fallback parsing) [1]
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
    if (!isMarketFadingOut) {
      setAnimateMarket(true)
    }
  }, [isMarketFadingOut])

  // News Auto-rotation cycle
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

  // Portfolio tabs Auto-rotation cycle
  useEffect(() => {
    const timeSinceClick = Date.now() - lastManualMarketClick
    const delayUntilAutoCycle = Math.max(0, 20000 - timeSinceClick)
    let cycleInterval

    const startAutoCycleTimeout = setTimeout(() => {
      cycleInterval = setInterval(() => {
        setIsMarketFadingOut(true)
        setTimeout(() => {
          setMarketCategory(current => {
            const next = current === 'WATCHLIST' ? 'PORTFOLIO' : 'WATCHLIST'
            setDisplayMarketTab(next)
            setIsMarketFadingOut(false)
            return next
          })
        }, 550)
      }, 6000) 
    }, delayUntilAutoCycle)

    return () => {
      clearTimeout(startAutoCycleTimeout)
      if (cycleInterval) clearInterval(cycleInterval)
    }
  }, [lastManualMarketClick])

  const handleManualCategoryChange = (category) => {
    if (category === displayCategory) return
    setLastManualClick(Date.now()) 
    setAnimateNews(false) 
    setIsFadingOut(false)
    setNewsCategory(category)
    setDisplayCategory(category)
  }

  const handleManualMarketChange = (category) => {
    if (category === displayMarketTab) return
    setLastManualMarketClick(Date.now()) 
    setAnimateMarket(false) 
    setIsMarketFadingOut(false)
    setMarketCategory(category)
    setDisplayMarketTab(category)
  }

  const registerMarketInteraction = () => {
    setLastManualMarketClick(Date.now())
  }

  const handleMountUrl = () => {
    setYtUrl(tempYtUrl)
  }

  const handleAddSymbol = () => {
    const formatted = searchQuery.trim().toUpperCase()
    if (!formatted) return
    if (starredSymbols.includes(formatted)) {
      setSearchError('TKR_ERR // ALREADY_STARRED')
      return
    }
    setSearchError('VERIFYING_TICKER_...')

    fetch(`https://finnhub.io/api/v1/quote?symbol=${formatted}&token=${FINNHUB_KEY}`)
      .then(res => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(data => {
        if (!data || data.c === 0 || data.c === null) throw new Error()
        setStarredSymbols(prev => [...prev, formatted])
        setSearchQuery('')
        setSearchError('')
      })
      .catch(() => {
        setSearchError('TKR_ERR // INVALID_SYMBOL')
      })
  }

  const handleRemoveSymbol = (sym) => {
    setStarredSymbols(prev => prev.filter(s => s !== sym))
  }

  const handleAddHolding = () => {
    const sanitizeInput = (val) => val.replace(/[$,€,₺,\s]/g, '').replace(',', '.')
    const sym = portTicker.trim().toUpperCase()
    const qty = parseFloat(sanitizeInput(portQty))
    const price = parseFloat(sanitizeInput(portPrice))

    if (!sym || isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
      setPortError('VAL_ERR // INVALID_TRANSACTION')
      return
    }
    setPortError('VERIFYING_ASSET_NODE_...')

    fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${FINNHUB_KEY}`)
      .then(res => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(data => {
        if (!data || data.c === 0 || data.c === null) throw new Error()
        setHoldings(prev => {
          const existingIndex = prev.findIndex(h => h.symbol === sym)
          if (existingIndex >= 0) {
            const existing = prev[existingIndex]
            const updatedQty = existing.qty + qty
            const updatedCostBasis = ((existing.qty * existing.cost) + (qty * price)) / updatedQty
            const copy = [...prev]
            copy[existingIndex] = { symbol: sym, qty: updatedQty, cost: updatedCostBasis }
            return copy
          } else {
            return [...prev, { symbol: sym, qty, cost: price }]
          }
        })
        setPortTicker('')
        setPortQty('')
        setPortPrice('')
        setPortError('')
      })
      .catch(() => {
        setPortError('TKR_ERR // INVALID_SYMBOL')
      })
  }
  const handleSellHolding = () => {
    const sanitizeInput = (val) => val.replace(/[$,€,₺,\s]/g, '').replace(',', '.')
    const sym = sellTicker.trim().toUpperCase()
    const qty = parseFloat(sanitizeInput(sellQty))

    const existing = holdings.find(h => h.symbol === sym)

    if (!sym || isNaN(qty) || qty <= 0) {
      setSellError('VAL_ERR // INVALID_TRANSACTION')
      return
    }
    if (!existing) {
      setSellError('TKR_ERR // NOT_IN_PORTFOLIO')
      return
    }
    if (qty > existing.qty) {
      setSellError(`QTY_ERR // ONLY ${existing.qty} SHARES HELD`)
      return
    }

    setHoldings(prev => {
      const remaining = existing.qty - qty
      if (remaining <= 0) {
        return prev.filter(h => h.symbol !== sym)
      }
      return prev.map(h => 
        h.symbol === sym ? { ...h, qty: remaining } : h
      )
    })

    setSellTicker('')
    setSellQty('')
    setSellPrice('')
    setSellError('')
  }
  const handleRemoveHolding = (sym) => {
  setHoldings(prev => prev.filter(h => h.symbol !== sym))
}

  // To-Do list operations [1]
  const handleAddTodo = () => {
    const cleanText = newTodo.trim().toUpperCase()
    if (!cleanText) return
    setTodos(prev => [...prev, { id: Date.now(), text: cleanText, completed: false, subTasks: [] }])
    setNewTodo('')
  }

  const handleToggleTodo = (id) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t))
  }

  const handleRemoveTodo = (id) => {
    setTodos(prev => prev.filter(t => t.id !== id))
    setExpandedTodos(prev => prev.filter(item => item !== id))
  }

  const handleToggleExpand = (id) => {
    setExpandedTodos(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  const handleSubInputChange = (todoId, val) => {
    setSubTaskInputs(prev => ({ ...prev, [todoId]: val }))
  }

  const handleAddSubTask = (todoId) => {
    const text = (subTaskInputs[todoId] || '').trim().toUpperCase()
    if (!text) return
    setTodos(prev => prev.map(t => {
      if (t.id === todoId) {
        const subs = t.subTasks || []
        return { ...t, subTasks: [...subs, { id: Date.now(), text, completed: false }] }
      }
      return t
    }))
    setSubTaskInputs(prev => ({ ...prev, [todoId]: '' }))
  }

  const handleToggleSubTask = (todoId, subId) => {
    setTodos(prev => prev.map(t => {
      if (t.id === todoId) {
        const updatedSubs = (t.subTasks || []).map(s => 
          s.id === subId ? { ...s, completed: !s.completed } : s
        )
        return { ...t, subTasks: updatedSubs }
      }
      return t
    }))
  }

  const handleRemoveSubTask = (todoId, subId) => {
    setTodos(prev => prev.map(t => {
      if (t.id === todoId) {
        const updatedSubs = (t.subTasks || []).filter(s => s.id !== subId)
        return { ...t, subTasks: updatedSubs }
      }
      return t
    }))
  }

  // Draggable To-Do rows (Isolated to prevent bubbling up to RGL viewport container)
  const handleDragStart = (e, id) => {
    e.stopPropagation(); // Stops parent grid layout triggers [1]
    setDraggedTodoId(id);
    e.dataTransfer.effectAllowed = 'move';
  }

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation(); // Stops parent grid layout triggers [1]
  }

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    e.stopPropagation(); // Stops parent grid layout triggers [1]
    if (draggedTodoId === null || draggedTodoId === targetId) return;
    setTodos(prev => {
      const copy = [...prev];
      const draggedIndex = copy.findIndex(t => t.id === draggedTodoId);
      const targetIndex = copy.findIndex(t => t.id === targetId);
      if (draggedIndex === -1 || targetIndex === -1) return prev;
      const [draggedItem] = copy.splice(draggedIndex, 1);
      copy.splice(targetIndex, 0, draggedItem);
      return copy;
    });
    setDraggedTodoId(null);
  }

  const handleStartEditTodo = (id, text) => {
    setEditingTodoId(id)
    setEditingTodoValue(text)
  }

  const handleSaveEditTodo = (id) => {
    const clean = editingTodoValue.trim().toUpperCase()
    if (!clean) {
      setEditingTodoId(null)
      return
    }
    setTodos(prev => prev.map(t => t.id === id ? { ...t, text: clean } : t))
    setEditingTodoId(null)
  }

  // Defensive layout observer to block temporary items from polluting state and localStorage [1]
  const handleLayoutChange = (currentLayout, allLayouts) => {
    const cleanedLayouts = {}
    Object.keys(allLayouts).forEach(breakpoint => {
      cleanedLayouts[breakpoint] = allLayouts[breakpoint]
        .filter(item => item.i !== '__dropping-elem__' && item.i !== 'dropping' && !item.i.startsWith('dropping-'))
    })
    setLayouts(cleanedLayouts)
    localStorage.setItem('dashboardLayouts', JSON.stringify(cleanedLayouts))
  }

  

  
  const isContentHidden = animateNews ? (news.loading || isFadingOut) : false
  const isMarketContentHidden = animateMarket ? isMarketFadingOut : false
  
  const defaultFallbackUrl = 'https://www.youtube.com/watch?v=jfKfPfyJRdk';
  const targetUrlEvaluated = useDefaultYt ? defaultFallbackUrl : ytUrl
  const activeEmbedUrl = getYoutubeEmbedUrl(targetUrlEvaluated)

  // Portfolio calculations [1]
  let totalCostBasisSum = 0
  let totalCurrentValSum = 0

  const processedHoldingsList = holdings.map(h => {
    const rawTickerData = marketData[h.symbol] || { error: true }
    const currentUnitPriceResolved = rawTickerData.error 
      ? h.cost 
      : parseFloat(rawTickerData.price.replace(/[^0-9.]/g, '')) 

    const initialCostBasis = h.qty * h.cost
    const currentPositionValue = h.qty * currentUnitPriceResolved
    const profitLossUSD = currentPositionValue - initialCostBasis
    const profitLossPct = initialCostBasis > 0 ? (profitLossUSD / initialCostBasis) * 100 : 0

    totalCostBasisSum += initialCostBasis
    totalCurrentValSum += currentPositionValue

    return {
      ...h,
      currentPrice: currentUnitPriceResolved,
      currentValue: currentPositionValue,
      profitLossUSD,
      profitLossPct,
      error: rawTickerData.error
    }
  })

  const globalProfitLossUSD = totalCurrentValSum - totalCostBasisSum
  const globalProfitLossPct = totalCostBasisSum > 0 ? (globalProfitLossUSD / totalCostBasisSum) * 100 : 0

  // State-driven Bottom Storage Compartment docking (Consolidate modules) [1]
  const handleDockWidget = (id) => {
    if (dockedWidgets.includes(id)) return

    const currentItem = layouts.lg?.find(item => item.i === id) || defaultLayouts.lg.find(item => item.i === id)
    if (currentItem) {
      setLastCoordinates(prev => ({ ...prev, [id]: currentItem }))
    }

    setDockedWidgets(prev => [...prev, id])

    setLayouts(prev => {
      const updated = {}
      Object.keys(prev).forEach(breakpoint => {
        updated[breakpoint] = prev[breakpoint].filter(item => item.i !== id)
      })
      localStorage.setItem('dashboardLayouts', JSON.stringify(updated))
      return updated
    })

    setPreviewDockingId(null)
    setIsDockOpen(false)
  }

  // Restore dropped widget onto target grid space, dynamically resolving layout collisions [1]
  const handleRestoreFromDock = (id, layout, layoutItem) => {
  const targetId = id || droppingWidgetId
  if (!targetId) return
  if (!layoutItem) {
    setDroppingWidgetId(null)
    setIsDockOpen(false)
    return
  }

    // Explicitly reset dropping trackers and collapse the storage bay drawer on drop [3]
    setDroppingWidgetId(null)
    setIsDockOpen(false)

    setDockedWidgets(prev => prev.filter(w => w !== targetId))
    
    setLayouts(prev => {
      const updated = { ...prev }
      const bp = currentBreakpoint || 'lg'
      
      // Update layouts array using collision resolved RGL data block
      if (updated[bp]) {
        const restoredItem = {
          i: targetId,
          x: layoutItem.x,
          y: layoutItem.y,
          w: layoutItem.w,
          h: layoutItem.h,
          minW: defaultLayouts[bp]?.find(d => d.i === targetId)?.minW || 2,
          minH: defaultLayouts[bp]?.find(d => d.i === targetId)?.minH || 3
        }

        // Clean out duplicates or placeholder artifacts
        const cleanedLayout = layout.filter(
          item => item.i !== '__dropping-elem__' && item.i !== 'dropping' && item.i !== targetId
        )
        updated[bp] = [...cleanedLayout, restoredItem]
      }
      
      // Fallback cross-breakpoint sync to prevent cross resolution glitching
      const otherBp = bp === 'lg' ? 'md' : 'lg'
      if (updated[otherBp]) {
        const defaultOther = defaultLayouts[otherBp]?.find(d => d.i === targetId) || { w: 3, h: 4, minW: 2, minH: 3 }
        const cleanedOther = updated[otherBp].filter(
          item => item.i !== '__dropping-elem__' && item.i !== 'dropping' && item.i !== targetId
        )
        updated[otherBp] = [...cleanedOther, {
          i: targetId,
          x: layoutItem.x,
          y: layoutItem.y,
          w: layoutItem.w,
          h: layoutItem.h,
          minW: defaultOther.minW,
          minH: defaultOther.minH
        }]
      }

      localStorage.setItem('dashboardLayouts', JSON.stringify(updated))
      return updated
    })
  }


  // Helper method to detect dragging events hovering over bottom panel area
  const isDraggingOverBottomBay = (e) => {
    const clientY = e?.clientY || e?.nativeEvent?.clientY || (e?.touches && e?.touches[0]?.clientY)
    if (!clientY) return false
    return clientY > window.innerHeight - 150
  }

  // Mini-folder visual morph previews
  const renderFolderPreview = (displayName) => (
    <div className="w-full h-full bg-[#0c1821]/95 border-l-4 border-[#d07018] border-y border-r border-[#1c3547] p-3 rounded-r flex flex-col justify-center gap-1 shadow-[0_0_15px_rgba(208,112,24,0.1)] select-none font-sans">
      <div className="text-[10px] font-bold text-cyan-100 truncate uppercase">
        {displayName}
      </div>
      <div className="text-[8px] text-amber-500 font-bold tracking-widest uppercase animate-pulse">
        STATUS: CONVERTING_TO_FILE_BAY_...
      </div>
    </div>
  )
  // High-Resolution drawing subroutine with parent null-safety guards [3]
  const drawGraph = (canvas) => {
    if (!canvas || !canvas.parentElement) return
    const ctx = canvas.getContext('2d')
    const width = canvas.width = canvas.parentElement.clientWidth
    const height = canvas.height = Math.max(180, canvas.parentElement.clientHeight - 130)

    ctx.clearRect(0, 0, width, height)
    const centerX = width / 2
    const centerY = height / 2

    // 1. Draw grid
    ctx.strokeStyle = 'rgba(28, 53, 71, 0.2)'
    ctx.lineWidth = 1
    ctx.font = '8px sans-serif'
    ctx.fillStyle = 'rgba(96, 128, 154, 0.4)'

    const startX = (centerX % graphScale) - (graphCenter.x * graphScale) % graphScale
    for (let x = startX - graphScale; x < width + graphScale; x += graphScale) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
      const cartX = (x - centerX) / graphScale + graphCenter.x
      if (Math.abs(cartX) > 0.01) {
        ctx.fillText(cartX.toFixed(1), x + 2, centerY - 4)
      }
    }

    const startY = (centerY % graphScale) + (graphCenter.y * graphScale) % graphScale
    for (let y = startY - graphScale; y < height + graphScale; y += graphScale) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
      const cartY = (centerY - y) / graphScale + graphCenter.y
      if (Math.abs(cartY) > 0.01) {
        ctx.fillText(cartY.toFixed(1), centerX + 4, y - 2)
      }
    }

    // 2. Draw Main Axis
    ctx.strokeStyle = 'rgba(28, 53, 71, 0.6)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    const axisX = centerX - graphCenter.x * graphScale
    const axisY = centerY + graphCenter.y * graphScale
    ctx.moveTo(0, axisY)
    ctx.lineTo(width, axisY)
    ctx.moveTo(axisX, 0)
    ctx.lineTo(axisX, height)
    ctx.stroke()

    // 3. Marching Squares multi-contour plotter
    const colors = ['#00d0ff', '#ff7b00', '#00ff5e', '#a340ff', '#fa0036']
    const step = 4 
    const cols = Math.floor(width / step) + 1
    const rows = Math.floor(height / step) + 1

    equations.forEach((eq, index) => {
      try {
        const fn = compileEquationToFn(eq)
        const grid = []

        for (let c = 0; c < cols; c++) {
          grid[c] = []
          const screenX = c * step
          const cartX = (screenX - centerX) / graphScale + graphCenter.x

          for (let r = 0; r < rows; r++) {
            const screenY = r * step
            const cartY = (centerY - screenY) / graphScale + graphCenter.y
            try {
              grid[c][r] = fn.evaluate({ x: cartX, y: cartY })
            } catch {
              grid[c][r] = NaN
            }
          }
        }

        ctx.beginPath()
        ctx.strokeStyle = colors[index % colors.length]
        ctx.lineWidth = 2

        for (let c = 0; c < cols - 1; c++) {
          for (let r = 0; r < rows - 1; r++) {
            const x0 = c * step
            const x1 = (c + 1) * step
            const y0 = r * step
            const y1 = (r + 1) * step

            const v00 = grid[c][r]
            const v10 = grid[c + 1][r]
            const v01 = grid[c][r + 1]
            const v11 = grid[c + 1][r + 1]

            if (isNaN(v00) || isNaN(v10) || isNaN(v01) || isNaN(v11)) continue

            const epsilon = 1e-9
            const adjustZero = (val) => val === 0 ? epsilon : val
            const adj00 = adjustZero(v00)
            const adj10 = adjustZero(v10)
            const adj01 = adjustZero(v01)
            const adj11 = adjustZero(v11)

            const crossings = []
            if (adj00 * adj10 < 0) crossings.push({ x: x0 + step * (Math.abs(adj00) / (Math.abs(adj00) + Math.abs(adj10))), y: y0 })
            if (adj10 * adj11 < 0) crossings.push({ x: x1, y: y0 + step * (Math.abs(adj10) / (Math.abs(adj10) + Math.abs(adj11))) })
            if (adj01 * adj11 < 0) crossings.push({ x: x0 + step * (Math.abs(adj01) / (Math.abs(adj01) + Math.abs(adj11))), y: y1 })
            if (adj00 * adj01 < 0) crossings.push({ x: x0, y: y0 + step * (Math.abs(adj00) / (Math.abs(adj00) + Math.abs(adj01))) })

            if (crossings.length >= 2) {
              ctx.moveTo(crossings[0].x, crossings[0].y)
              ctx.lineTo(crossings[1].x, crossings[1].y)
            }
          }
        }
        ctx.stroke()
      } catch {}
    })

    // 4. Render intersection nodes & lines
    searchedPoints.forEach(pt => {
      ctx.fillStyle = '#ff8c00'
      ctx.strokeStyle = 'rgba(255, 140, 0, 0.6)'
      ctx.lineWidth = 1

      if (pt.type === 'point') {
        const screenX = centerX + (pt.x - graphCenter.x) * graphScale
        const screenY = centerY - (pt.y - graphCenter.y) * graphScale

        ctx.beginPath()
        ctx.arc(screenX, screenY, 4.5, 0, Math.PI * 2)
        ctx.fill()
        const roundedX = Math.round(pt.x * 1000) / 1000
        const roundedY = Math.round(pt.y * 1000) / 1000
        ctx.fillText(`P(${roundedX}, ${roundedY})`, screenX + 8, screenY - 5)
      } else if (pt.type === 'x-line') {
        const screenX = centerX + (pt.val - graphCenter.x) * graphScale
        ctx.beginPath()
        ctx.setLineDash([4, 4])
        ctx.moveTo(screenX, 0)
        ctx.lineTo(screenX, height)
        ctx.stroke()
        ctx.setLineDash([])
    
        equations.forEach(eq => {
          try {
            let normalized = eq
              .replace(/√\s*\(([^)]+)\)/g, 'sqrt($1)')
              .replace(/√\s*([a-zA-Z0-9.]+)/g, 'sqrt($1)')
              .replace(/\bln\(/g, 'log(')
              .replace(/\^1\/2/g, '^0.5')
              .replace(/\^\(1\/2\)/g, '^0.5')

            let rightSide = normalized
            if (normalized.includes('=')) {
              rightSide = normalized.split('=')[1].trim()
            }
            const compRight = math.compile(rightSide)
            const yVal = compRight.evaluate({ x: pt.val })
            const screenY = centerY - (yVal - graphCenter.y) * graphScale

            if (!isNaN(screenY) && isFinite(screenY)) {
              ctx.beginPath()
              ctx.arc(screenX, screenY, 4, 0, Math.PI * 2)
              ctx.fill()
              const roundedY = Math.round(yVal * 100) / 100
              ctx.fillText(`(${pt.val}, ${roundedY})`, screenX + 8, screenY - 5)
            }
          } catch {}
        })
      }
    })

    // 5. Extrema solvers
    if (showExtremaFinder) {
      ctx.strokeStyle = 'rgba(208, 112, 24, 0.45)'
      ctx.lineWidth = 1

      const xMinVal = parseFloat(domainMin)
      if (!isNaN(xMinVal)) {
        const screenX = centerX + (xMinVal - graphCenter.x) * graphScale
        ctx.beginPath()
        ctx.setLineDash([3, 3])
        ctx.moveTo(screenX, 0)
        ctx.lineTo(screenX, height)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(208, 112, 24, 0.6)'
        ctx.fillText(`x_min = ${xMinVal}`, screenX + 4, 12)
      }

      const xMaxVal = parseFloat(domainMax)
      if (!isNaN(xMaxVal)) {
        const screenX = centerX + (xMaxVal - graphCenter.x) * graphScale
        ctx.beginPath()
        ctx.setLineDash([3, 3])
        ctx.moveTo(screenX, 0)
        ctx.lineTo(screenX, height)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(208, 112, 24, 0.6)'
        ctx.fillText(`x_max = ${xMaxVal}`, screenX + 4, 12)
      }

      if (resolvedExtrema) {
        const screenX = centerX + (resolvedExtrema.x - graphCenter.x) * graphScale
        const screenY = centerY - (resolvedExtrema.y - graphCenter.y) * graphScale

        ctx.beginPath()
        ctx.arc(screenX, screenY, 6, 0, Math.PI * 2)
        ctx.fillStyle = '#ff8c00'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1
        ctx.stroke()

        const roundedX = Math.round(resolvedExtrema.x * 1000) / 1000
        const roundedY = Math.round(resolvedExtrema.y * 1000) / 1000
        ctx.font = 'bold 9px sans-serif'
        ctx.fillStyle = '#ff8c00'
        ctx.fillText(`${resolvedExtrema.type}: (${roundedX}, ${roundedY})`, screenX + 10, screenY - 5)
      }
    }
  }

  // Safe Context-Driven Callback Refs drawing elements seamlessly on mount/state updates [1, 3]
  const gridCanvasRef = React.useCallback((node) => {
    if (node) drawGraph(node)
  }, [equations, layouts, graphScale, graphCenter, searchedPoints, showExtremaFinder, domainMin, domainMax, resolvedExtrema, focalWidgetId])

  const focalCanvasRef = React.useCallback((node) => {
    if (node) drawGraph(node)
  }, [equations, graphScale, graphCenter, searchedPoints, showExtremaFinder, domainMin, domainMax, resolvedExtrema])
  
  // Sub-System inner content module builder (Context-independent context mapping) [1]
  const renderSubsystemInnerContent = (id, isFocal = false) => {
    const activeRef = isFocal ? focalCanvasRef : gridCanvasRef // Assigns correct high-performance callback ref [1, 3]
    switch (id) {
      
      case 'market':
        return (
          <div className="p-4 flex-grow flex flex-col justify-start gap-y-3 overflow-hidden font-sans">
            <div className="flex gap-2 select-none border-b border-[#1c3547]/30 pb-2 text-xs font-bold">
              <button 
                onClick={() => handleManualMarketChange('WATCHLIST')}
                className={`px-3 py-1 rounded border transition-colors focus:outline-none cursor-pointer ${
                  displayMarketTab === 'WATCHLIST' 
                    ? 'bg-[#d07018] text-black border-[#d07018]' 
                    : 'border-[#1c3547] text-[#60809a] hover:text-cyan-400'
                }`}
              >
                [ WATCHLIST ]
              </button>
              <button 
                onClick={() => handleManualMarketChange('PORTFOLIO')}
                className={`px-3 py-1 rounded border transition-colors focus:outline-none cursor-pointer ${
                  displayMarketTab === 'PORTFOLIO' 
                    ? 'bg-[#d07018] text-black border-[#d07018]' 
                    : 'border-[#1c3547] text-[#60809a] hover:text-cyan-400'
                }`}
              >
                [ PORTFOLIO ]
              </button>
            </div>

            <div className={`transition-all ${
              animateMarket ? 'duration-700 ease-in-out' : 'duration-0'
            } ${
              isMarketContentHidden ? 'opacity-0 scale-98' : 'opacity-100 scale-100'
            } flex-grow overflow-hidden flex flex-col justify-start gap-y-3`}>

              {marketCategory === 'WATCHLIST' && (
                <div className="flex flex-col justify-start gap-y-3 flex-grow overflow-hidden">
                  <div className="select-none">
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="ENTER TICKER... (E.G. TSLA, MSFT)" 
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value)
                          registerMarketInteraction()
                        }}
                        onFocus={registerMarketInteraction}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
                        className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-3 py-1.5 rounded focus:outline-none focus:border-[#00d2ff] flex-grow uppercase"
                      />
                      <button 
                        onClick={handleAddSymbol}
                        className="bg-[#132533] hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 text-xs px-4 rounded font-bold transition-all cursor-pointer"
                      >
                        STAR
                      </button>
                    </div>
                    {searchError && (
                      <div className="text-xs text-[#d07018] mt-1 tracking-wider animate-pulse font-bold">
                        {searchError}
                      </div>
                    )}
                  </div>

                  <div className="flex-grow overflow-auto space-y-2 pr-1">
                    {starredSymbols.length === 0 ? (
                      <div className="text-xs text-cyan-700 italic select-none py-6 text-center">
                        NO_STARRED_TICKERS
                      </div>
                    ) : (
                      <>
                        <div className="text-xs text-[#60809a] flex justify-between font-bold select-none mb-1 tracking-widest border-b border-[#1c3547]/20 pb-1.5">
                          <span className="w-[25%] text-left">TICKER</span>
                          <span className="w-[40%] text-left pl-2">VALUE_EUR</span>
                          <span className="w-[25%] text-right">CHANGE_24H</span>
                          <span className="w-[10%]"></span>
                        </div>

                        {starredSymbols.map(sym => {
                          const data = marketData[sym] || { price: '---', change: '0.00%', isPositive: true }
                          return (
                            <div key={sym} className="flex justify-between items-center text-sm lg:text-base">
                              <span className="text-[#60809a] font-bold w-[25%] text-left whitespace-nowrap overflow-hidden text-ellipsis">[ {sym} ]</span>
                              <span className="text-cyan-200 text-left w-[40%] pl-2 font-semibold truncate">{data.price}</span>
                              <span className={`font-extrabold tracking-wider text-right w-[25%] ${data.isPositive ? 'text-emerald-400' : 'text-rose-500'}`}>
                                {data.change}
                              </span>
                              <button 
                                onClick={() => handleRemoveSymbol(sym)}
                                className="text-[#60809a]/40 hover:text-rose-500 text-xs font-bold w-[10%] text-center focus:outline-none cursor-pointer"
                              >
                                [✕]
                              </button>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                </div>
              )}

              {marketCategory === 'PORTFOLIO' && (
                <div className="flex flex-col justify-start gap-y-3 flex-grow overflow-hidden select-none">
                  <div className="bg-[#090e14] border border-[#1c3547]/30 p-2.5 rounded flex justify-between items-center text-xs lg:text-sm">
                    <div>
                      <div className="text-[#60809a] font-bold text-[9px] tracking-widest uppercase">PORTFOLIO_VALUE</div>
                      <div className="text-cyan-100 font-extrabold text-base lg:text-lg">€{totalCurrentValSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[#60809a] font-bold text-[9px] tracking-widest uppercase">TOTAL_RETURN</div>
                      <div className={`font-extrabold text-xs lg:text-sm ${globalProfitLossUSD >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                        {globalProfitLossUSD >= 0 ? '+' : ''}€{globalProfitLossUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({globalProfitLossUSD >= 0 ? '+' : ''}{globalProfitLossPct.toFixed(2)}%)
                      </div>
                    </div>
                  </div>
                
                  <div className="flex gap-1 p-0.5 bg-[#090e14] border border-[#1c3547] rounded">
                    <button
                      onClick={() => setPortfolioMode('buy')}
                      className={`flex-1 text-[10px] font-bold tracking-widest py-1.5 rounded transition-all cursor-pointer ${
                        portfolioMode === 'buy'
                          ? 'bg-[#00d2ff]/15 text-cyan-400 border border-cyan-500/40'
                          : 'text-[#60809a] border border-transparent hover:text-cyan-400'
                      }`}
                    >
                      BUY
                    </button>
                    <button
                      onClick={() => setPortfolioMode('sell')}
                      className={`flex-1 text-[10px] font-bold tracking-widest py-1.5 rounded transition-all cursor-pointer ${
                        portfolioMode === 'sell'
                          ? 'bg-[#d07018]/15 text-[#d07018] border border-[#d07018]/40'
                          : 'text-[#60809a] border border-transparent hover:text-[#d07018]'
                      }`}
                    >
                      SELL
                    </button>
                  </div>
                  {portfolioMode === 'buy' && (
                    <div className="space-y-1 bg-[#0e1a24]/30 p-2.5 rounded border border-[#1c3547]/10">
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="TICKER" 
                        value={portTicker}
                        onChange={(e) => {
                          setPortTicker(e.target.value)
                          if (e.target.value.trim() === '') setPortError('')
                          registerMarketInteraction()
                        }}
                        onFocus={registerMarketInteraction}
                        className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#00d2ff] w-16 uppercase"
                      />
                      <input 
                        type="text" 
                        placeholder="QTY" 
                        value={portQty}
                        onChange={(e) => {
                          setPortQty(e.target.value)
                          registerMarketInteraction()
                        }}
                        onFocus={registerMarketInteraction}
                        className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#00d2ff] w-14"
                      />
                      <input 
                        type="text" 
                        placeholder="PRICE_EUR" 
                        value={portPrice}
                        onChange={(e) => {
                          setPortPrice(e.target.value)
                          registerMarketInteraction()
                        }}
                        onFocus={registerMarketInteraction}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddHolding()}
                        className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#00d2ff] flex-grow"
                      />
                      <button 
                        onClick={handleAddHolding}
                        className="bg-[#132533] hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 text-xs px-3 rounded font-bold transition-all cursor-pointer"
                      >
                        ADD
                      </button>
                    </div>
                    {portError && (
                      <div className="text-[10px] text-[#d07018] tracking-wider animate-pulse font-bold uppercase">
                        {portError}
                      </div>
                    )}
                  </div>
                  )}
                  {portfolioMode === 'sell' && (
                    <div className="space-y-1 bg-[#0e1a24]/30 p-2.5 rounded border border-[#1c3547]/10">
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="TICKER" 
                        value={sellTicker}
                        onChange={(e) => {
                          setSellTicker(e.target.value)
                          if (e.target.value.trim() === '') setSellError('')
                          registerMarketInteraction()
                        }}
                        onFocus={registerMarketInteraction}
                        className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#d07018] w-16 uppercase"
                      />
                      <input 
                        type="text" 
                        placeholder="QTY" 
                        value={sellQty}
                        onChange={(e) => {
                          setSellQty(e.target.value)
                          registerMarketInteraction()
                        }}
                        onFocus={registerMarketInteraction}
                        className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#d07018] w-14"
                      />
                      <input 
                        type="text" 
                        placeholder="PRICE_EUR" 
                        value={sellPrice}
                        onChange={(e) => {
                          setSellPrice(e.target.value)
                          registerMarketInteraction()
                        }}
                        onFocus={registerMarketInteraction}
                        onKeyDown={(e) => e.key === 'Enter' && handleSellHolding()}
                        className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#d07018] flex-grow"
                      />
                      <button 
                        onClick={handleSellHolding}
                        className="bg-[#2a1410] hover:bg-[#3a1c15] active:bg-[#d07018] active:text-black border border-[#d07018]/40 text-[#d07018] text-xs px-3 rounded font-bold transition-all cursor-pointer"
                      >
                        SELL
                      </button>
                    </div>
                    {sellError && (
                      <div className="text-[10px] text-rose-500 tracking-wider animate-pulse font-bold uppercase">
                        {sellError}
                      </div>
                    )}
                  </div>
                  )}
                  <div className="flex-grow overflow-auto space-y-2 pr-1">
                    {holdings.length === 0 ? (
                      <div className="text-xs text-cyan-700 italic select-none py-6 text-center">
                        NO_ACTIVE_HOLDINGS
                      </div>
                    ) : (
                      <>
                        <div className="text-xs text-[#60809a] flex justify-between font-bold select-none mb-1.5 tracking-widest border-b border-[#1c3547]/20 pb-1.5">
                          <span className="w-[22%] text-left">TICKER</span>
                          <span className="w-[23%] text-center">SHARES</span>
                          <span className="w-[27%] text-center">VALUE_EUR</span>
                          <span className="w-[20%] text-right">RETURN%</span>
                          <span className="w-[8%]"></span>
                        </div>

                        {processedHoldingsList.map(h => (
                          <div key={h.symbol} className="flex justify-between items-center text-xs lg:text-sm">
                            <span className="text-[#60809a] font-bold w-[22%] text-left whitespace-nowrap overflow-hidden text-ellipsis">[ {h.symbol} ]</span>
                            <span className="w-[23%] text-center text-cyan-200 font-semibold truncate" title={h.qty}>{h.qty}</span>
                            <span className="w-[27%] text-center text-cyan-100 font-semibold truncate">€{h.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className={`font-extrabold tracking-wider text-right w-[20%] ${h.profitLossUSD >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                              {h.profitLossUSD >= 0 ? '+' : ''}{h.profitLossPct.toFixed(1)}%
                            </span>
                            <button 
                              onClick={() => handleRemoveHolding(h.symbol)}
                              className="text-[#60809a]/40 hover:text-rose-500 text-xs font-bold w-[8%] text-center focus:outline-none cursor-pointer"
                            >
                              [✕]
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      case 'main':
        return (
          <div className="p-4 flex-grow flex flex-col justify-between overflow-hidden font-sans">
            <div className="flex flex-col gap-2 flex-grow my-2 overflow-hidden">
              <div className="text-xs text-[#60809a] font-bold tracking-widest flex justify-between select-none border-b border-[#1c3547]/30 pb-2">
                <span>INPUT_BUFFER // SECURE_TEXT_LOGGER</span>
                <span>CHARS: {tempText.length}</span>
              </div>
              <textarea
                placeholder="AWAITING INPUT_ ENTER SYSTEM LOGS OR SECURE NOTES HERE..."
                value={tempText}
                onChange={(e) => setTempText(e.target.value)}
                className="w-full h-full bg-[#090e14]/50 border border-[#1c3547] text-cyan-500/70 p-3 rounded text-lg lg:text-xl font-bold focus:outline-none focus:border-[#00d2ff] focus:shadow-[0_0_10px_rgba(0,210,255,0.08)] resize-none leading-relaxed transition-all duration-300 font-sans"
              />
            </div>
            
            <div className="text-xs text-[#60809a] flex justify-between border-t border-[#1c3547]/40 pt-3 select-none">
              <span>SECURITY // ENCRYPTED_SYS_NET</span>
              <span>BAUD_RATE // 115200</span>
            </div>
          </div>
        )
      case 'news':
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
      case 'social':
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
      case 'todo':
        return (
          <div className="p-4 flex-grow flex flex-col justify-start gap-y-3 overflow-hidden text-sm font-sans">
            <div className="flex gap-1.5">
              <input 
                type="text" 
                placeholder="ADD NEW OPERATIONAL TASK..." 
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTodo()}
                className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-xs px-3 py-1.5 rounded focus:outline-none focus:border-[#00d2ff] flex-grow uppercase font-sans"
              />
              <button 
                onClick={handleAddTodo}
                className="bg-[#132533] hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 text-xs px-3 rounded font-bold transition-all cursor-pointer font-sans"
              >
                ADD
              </button>
            </div>

            <div className="flex-grow overflow-auto pr-1 space-y-2">
              {todos.length === 0 ? (
                <div className="text-xs text-cyan-700 italic select-none py-4 text-center">
                  NO_ACTIVE_TASKS
                </div>
              ) : (
                todos.map(todo => {
                  const isExpanded = expandedTodos.includes(todo.id)
                  const subTasksArray = todo.subTasks || []
                  const isEditing = todo.id === editingTodoId

                  return (
                    <div 
                      key={todo.id} 
                      draggable={!isEditing}
                      onDragStart={(e) => handleDragStart(e, todo.id)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, todo.id)}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        setDraggedTodoId(null);
                      }}
                      className={`border-b border-[#1c3547]/10 pb-2 last:border-0 last:pb-0 transition-opacity duration-150 ${
                        draggedTodoId === todo.id ? 'opacity-40' : ''
                      }`}
                    >
                      <div className="flex justify-between items-center text-sm">
                        <div className="flex items-center gap-2 flex-grow overflow-hidden mr-2">
                          <button 
                            onClick={() => handleToggleExpand(todo.id)}
                            className="text-xs text-[#60809a] hover:text-cyan-400 font-bold focus:outline-none select-none transition-colors w-3 text-center cursor-pointer"
                            title={isExpanded ? "COLLAPSE SUB-TASKS" : "EXPAND SUB-TASKS"}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>

                          <button 
                            onClick={() => handleToggleTodo(todo.id)}
                            className={`w-5 h-5 flex-shrink-0 flex items-center justify-center text-xs font-extrabold rounded transition-all focus:outline-none select-none cursor-pointer ${
                              todo.completed 
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' 
                                : 'border border-[#1c3547] text-[#60809a] hover:text-cyan-400 hover:border-cyan-500/40'
                            }`}
                          >
                            {todo.completed ? '✓' : ''}
                          </button>
                          
                          {isEditing ? (
                          <input 
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(idx)
                              if (e.key === 'Escape') setEditingIndex(null)
                            }}
                            className="bg-[#090e14] border border-[#00d2ff] text-cyan-100 text-xs px-1 py-0.5 rounded focus:outline-none w-full font-sans" // Removed onBlur to protect editing lifecycle in portals [3]
                            autoFocus
                          />
                        ) : (
                            <span 
                              onDoubleClick={() => handleStartEditTodo(todo.id, todo.text)}
                              className={`truncate font-semibold uppercase leading-none cursor-grab active:cursor-grabbing select-none ${
                                todo.completed ? 'line-through text-cyan-700/50' : 'text-cyan-100'
                              }`}
                              title="DOUBLE-CLICK TO EDIT // DRAG TO REORDER"
                            >
                              {todo.text}
                            </span>
                          )}
                        </div>
                        
                        <button 
                          onClick={() => handleRemoveTodo(todo.id)}
                          className="text-[#60809a]/40 hover:text-rose-500 text-xs font-bold focus:outline-none flex-shrink-0 cursor-pointer"
                        >
                          [✕]
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="pl-8 pr-1 py-1.5 space-y-1.5 border-l border-[#1c3547]/30 ml-5 mt-1.5 transition-all duration-300">
                          {subTasksArray.length === 0 ? (
                            <div className="text-[10px] text-cyan-700/60 italic py-1 pl-1 select-none">
                              NO_SUB_TASKS_DECLARED
                            </div>
                          ) : (
                            subTasksArray.map(sub => (
                              <div key={sub.id} className="flex justify-between items-center text-xs">
                                <div className="flex items-center gap-2 overflow-hidden flex-grow mr-2">
                                  <button 
                                    onClick={() => handleToggleSubTask(todo.id, sub.id)}
                                    className={`w-4 h-4 flex-shrink-0 flex items-center justify-center text-[10px] font-extrabold rounded transition-all focus:outline-none select-none cursor-pointer ${
                                      sub.completed 
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                                        : 'border border-[#1c3547] text-[#60809a] hover:text-cyan-400 hover:border-cyan-500/40'
                                    }`}
                                  >
                                    {sub.completed ? '✓' : ''}
                                  </button>
                                  <span className={`truncate leading-none ${
                                    sub.completed ? 'line-through text-cyan-700/50' : 'text-cyan-200'
                                  }`}>
                                    {sub.text}
                                  </span>
                                </div>
                                <button 
                                  onClick={() => handleRemoveSubTask(todo.id, sub.id)}
                                  className="text-[#60809a]/40 hover:text-rose-500 text-[10px] font-bold pl-1.5 cursor-pointer"
                                >
                                  ✕
                                </button>
                              </div>
                            ))
                          )}

                          <div className="flex gap-1 pt-1.5 border-t border-[#1c3547]/10 select-none">
                            <input 
                              type="text" 
                              placeholder="ADD SUB-TASK..." 
                              value={subTaskInputs[todo.id] || ''}
                              onChange={(e) => handleSubInputChange(todo.id, e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddSubTask(todo.id)}
                              className="bg-[#090e14] border border-[#1c3547]/50 text-cyan-100 text-[10px] px-2 py-0.5 rounded focus:outline-none focus:border-[#00d2ff] flex-grow font-sans uppercase"
                            />
                            <button 
                              onClick={() => handleAddSubTask(todo.id)}
                              className="bg-[#132533] hover:bg-[#1c3547] border border-[#1c3547] text-cyan-400 text-xs px-2 rounded font-bold cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )
      case 'calculator':
        return (
          <div className="p-4 flex-grow flex flex-col justify-start gap-y-3 overflow-hidden text-sm font-sans">
            <div className="flex-grow relative h-full w-full overflow-hidden rounded bg-[#090e14] border border-[#1c3547]/50 shadow-[0_0_25px_rgba(6,182,212,0.05)]">
              <canvas 
                ref={activeRef} // Dynamic Context Canvas Mapping [1]
                className="absolute inset-0 w-full h-full block cursor-grab active:cursor-grabbing" 
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
              />

              <div className="absolute top-3 left-3 z-20">
                <button 
                  onClick={() => {
                    setShowExtremaFinder(!showExtremaFinder)
                    setResolvedExtrema(null)
                  }}
                  className={`px-2 py-1 rounded border text-[10px] font-bold transition-all focus:outline-none cursor-pointer ${
                    showExtremaFinder 
                      ? 'bg-[#d07018] text-black border-[#d07018]' 
                      : 'bg-[#132533]/80 border-[#1c3547] text-cyan-400 hover:text-cyan-200'
                  }`}
                >
                  {showExtremaFinder ? '[ CLOSE_ANALYSERS ]' : '[ EXTREMA_FINDER ]'}
                </button>
              </div>

              {showExtremaFinder && (
                <div className="absolute top-10 left-3 w-60 bg-slate-950/85 border border-cyan-500/20 backdrop-blur-md rounded p-3 flex flex-col gap-3 z-20 text-[10px]">
                  <div 
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const eq = e.dataTransfer.getData("text/plain")
                      setExtremaEq(eq)
                      setResolvedExtrema(null)
                    }}
                    className="border border-dashed border-cyan-500/30 bg-black/40 rounded p-3 text-center text-[9px] text-[#60809a] hover:border-cyan-400 hover:text-cyan-400 transition-all cursor-pointer"
                    title="DRAG AN ACTIVE FUNCTION & DROP HERE"
                  >
                    {extremaEq ? `TARGET // f(x) = ${extremaEq.toUpperCase()}` : '[ DROP ACTIVE FUNCTION HERE ]'}
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[#60809a] font-bold text-[8px] tracking-widest uppercase">DOMAIN_LIMITS [x_min, x_max]</span>
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="X_MIN"
                        value={domainMin}
                        onChange={(e) => { setDomainMin(e.target.value); setResolvedExtrema(null); }}
                        className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-[10px] px-2 py-1 rounded focus:outline-none focus:border-[#00d2ff] w-1/2"
                      />
                      <input 
                        type="text" 
                        placeholder="X_MAX"
                        value={domainMax}
                        onChange={(e) => { setDomainMax(e.target.value); setResolvedExtrema(null); }}
                        className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-[10px] px-2 py-1 rounded focus:outline-none focus:border-[#00d2ff] w-1/2"
                      />
                    </div>
                  </div>

                  <div className="flex justify-between items-center bg-[#090e14]/50 border border-[#1c3547]/20 p-2 rounded">
                    <span className="text-[#60809a] font-bold text-[8px] tracking-widest uppercase">RESOLVE_MODE</span>
                    <div className="flex gap-1.5 font-bold">
                      <button 
                        onClick={() => { setExtremaType('MAX'); setResolvedExtrema(null); }}
                        className={`px-1.5 py-0.5 rounded border text-[8px] transition-all focus:outline-none cursor-pointer ${
                          extremaType === 'MAX' 
                            ? 'bg-cyan-500 text-black border-cyan-500' 
                            : 'border-[#1c3547] text-[#60809a] hover:text-cyan-400'
                        }`}
                      >
                        MAX
                      </button>
                      <button 
                        onClick={() => { setExtremaType('MIN'); setResolvedExtrema(null); }}
                        className={`px-1.5 py-0.5 rounded border text-[8px] transition-all focus:outline-none cursor-pointer ${
                          extremaType === 'MIN' 
                            ? 'bg-rose-600 text-black border-rose-600' 
                            : 'border-[#1c3547] text-[#60809a] hover:text-cyan-400'
                        }`}
                      >
                        MIN
                      </button>
                    </div>
                  </div>

                  <button 
                    onClick={handleResolveExtrema}
                    className="w-full bg-[#132533] hover:bg-[#1c3547] active:bg-[#d07018] active:text-black border border-[#1c3547] text-cyan-400 py-1.5 rounded font-bold transition-all text-[10px] cursor-pointer"
                  >
                    RUN_ANALYSER
                  </button>
                </div>
              )}

              <div className="absolute bottom-4 right-[288px] flex flex-col gap-1 text-[10px] font-bold z-20">
                <button 
                  onClick={() => setGraphScale(prev => Math.min(128, prev * 1.25))}
                  className="bg-[#132533]/80 hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 w-7 h-7 rounded flex items-center justify-center transition-all focus:outline-none cursor-pointer"
                  title="ZOOM IN"
                >
                  +
                </button>
                <button 
                  onClick={() => setGraphScale(prev => Math.max(8, prev / 1.25))}
                  className="bg-[#132533]/80 hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 w-7 h-7 rounded flex items-center justify-center transition-all focus:outline-none cursor-pointer"
                  title="ZOOM OUT"
                >
                  -
                </button>
                <button 
                  onClick={() => { setGraphScale(32); setGraphCenter({ x: 0, y: 0 }); }}
                  className="bg-[#132533]/80 hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 w-7 h-7 rounded flex items-center justify-center transition-all focus:outline-none cursor-pointer"
                  title="RESET VIEWPORT (0,0)"
                >
                  ⌖
                </button>
              </div>

              <div className="absolute right-4 top-4 bottom-4 w-64 bg-transparent flex flex-col gap-4 justify-between h-[calc(100%-32px)] z-10 overflow-hidden">
                <div className="space-y-1.5 overflow-auto max-h-[45%] pr-1">
                  <div className="text-[7.5px] text-[#60809a] font-bold uppercase tracking-widest mb-1.5 border-b border-[#1c3547]/30 pb-1">ACTIVE_FUNCTIONS</div>
                  {equations.map((eq, idx) => {
                    const colors = ['text-cyan-400', 'text-amber-500', 'text-emerald-400', 'text-purple-400', 'text-rose-500']
                    const isEditing = idx === editingIndex

                    return (
                      <div 
                        key={idx} 
                        draggable={!isEditing}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          e.dataTransfer.setData("text/plain", eq)
                        }}
                        className="flex justify-between items-center bg-[#0c1821]/90 border border-[#1c3547]/50 px-2.5 py-1 rounded min-h-[26px] backdrop-blur-sm cursor-grab active:cursor-grabbing"
                        title="DRAG TO EXTREMA SENSOR"
                      >
                        {isEditing ? (
                          <input 
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit(idx)
                              if (e.key === 'Escape') setEditingIndex(null)
                            }}
                            onBlur={() => handleSaveEdit(idx)}
                            className="bg-[#090e14] border border-[#00d2ff] text-cyan-100 text-xs px-1 py-0.5 rounded focus:outline-none w-full font-sans"
                            autoFocus
                          />
                        ) : (
                          <span 
                            onClick={(e) => {
                              if (e.detail === 2) { // Native browser click detail counter bypasses synthetic overlay locks [3]
                                e.stopPropagation();
                                handleStartEdit(idx, eq);
                              }
                            }}
                            className={`text-xs font-bold truncate select-none cursor-pointer ${colors[idx % colors.length]}`} // Restored select-none to prevent selection highlight from blocking clicks [3]
                            title="DOUBLE-CLICK TO EDIT // DRAG TO ANALYZE"
                          >
                            {formatMathToJSX(eq)}
                          </span>
                        )}
                        {!isEditing && (
                          <button onClick={() => handleRemoveEquation(idx)} className="text-[#60809a]/40 hover:text-rose-500 text-[10px] font-bold ml-1.5 focus:outline-none cursor-pointer">✕</button>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="space-y-3.5 border-t border-[#1c3547]/20 pt-3">
                  <div>
                    <div className="text-[8px] text-[#60809a] font-bold uppercase tracking-widest mb-1.5 select-none">PLOT_EQUATION</div>
                    <div className="flex gap-1.5">
                      <input 
                        type="text" 
                        placeholder="" 
                        value={newEqInput}
                        onChange={(e) => setNewEqInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddEquation()}
                        className="bg-[#090e14]/80 border border-[#1c3547] text-cyan-100 text-xs px-3 py-1.5 rounded focus:outline-none focus:border-[#00d2ff] flex-grow font-sans"
                      />
                      <button 
                        onClick={handleAddEquation} 
                        className="bg-[#132533] hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 text-xs px-3 py-1.5 rounded font-bold transition-all focus:outline-none cursor-pointer"
                      >
                        ADD
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="text-[8px] text-[#60809a] font-bold uppercase tracking-widest mb-1.5 flex justify-between select-none">
                      <span>SEARCH_POINT</span>
                      {searchedPoints.length > 0 && (
                        <button onClick={handleClearPoints} className="text-rose-500 hover:underline hover:text-rose-400 font-bold focus:outline-none cursor-pointer">CLR_ALL</button>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <input 
                        type="text" 
                        placeholder="" 
                        value={searchPointInput}
                        onChange={(e) => setSearchPointInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearchPoint()}
                        className="bg-[#090e14]/90 border border-[#1c3547] text-cyan-100 text-xs px-3 py-1.5 rounded focus:outline-none focus:border-[#00d2ff] flex-grow font-sans"
                      />
                      <button 
                        onClick={handleSearchPoint} 
                        className="bg-[#132533] hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-[#1c3547] text-cyan-400 text-xs px-3 py-1.5 rounded font-bold transition-all focus:outline-none cursor-pointer"
                      >
                        PLOT
                      </button>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-[#090e14] text-[#00d2ff] font-sans p-6 relative overflow-x-hidden font-sans">
      
      {/* High-Tech Diagnostic Focal Animation Utility CSS Styles (With matching smooth exit fading Zoom) [3] */}
      <style>{`
        @keyframes focalAcquisitionIn {
          0% { opacity: 0; transform: scale(0.96) translateY(12px); }
          100% { opacity: 1; } /* Removing transform at 100% lets the browser discard the active graphics layer once idle [3] */
        }
        @keyframes focalAcquisitionOut {
          0% { opacity: 1; } 
          100% { opacity: 0; transform: scale(0.96) translateY(12px); }
        }
        @keyframes fadeOverlayIn {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes fadeOverlayOut {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        .animate-focalZoom {
          animation: focalAcquisitionIn 0.38s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-focalZoomOut {
          animation: focalAcquisitionOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-fadeOverlay {
          animation: fadeOverlayIn 0.38s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-fadeOverlayOut {
          animation: fadeOverlayOut 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {/* High-Tech System Header Bar */}
      <header 
          data-tauri-drag-region 
          className="flex justify-between items-center border-b border-[#1c3547]/85 pb-4 mb-6 select-none cursor-move"
        >
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-[#00d2ff] animate-pulse"></span>
          <span className="text-xs font-black tracking-widest uppercase text-cyan-200">TACTICAL_TELEMETRY // CONSOLE_BAY</span>
        </div>
        <div className="flex items-center gap-4">
          <button 
          onClick={toggleFullscreen}
          className="px-3 py-1.5 rounded border border-[#1c3547] text-[10px] font-bold tracking-widest text-[#60809a] hover:text-cyan-400 hover:border-[#00d2ff] transition-all cursor-pointer focus:outline-none"
          >
            [ ⤢ FULLSCREEN ]
          </button>
          {/* Explicit click-to-toggle archive index bottom drawer */}
          <button 
            onClick={() => setIsDockOpen(!isDockOpen)}
            className={`px-3 py-1.5 rounded border text-[10px] font-bold tracking-widest transition-all cursor-pointer focus:outline-none ${
              dockedWidgets.length > 0 
                ? 'bg-[#d07018]/15 border-[#d07018] text-[#d07018] shadow-[0_0_10px_rgba(208,112,24,0.2)] animate-pulse' 
                : 'border-[#1c3547] text-[#60809a] hover:text-cyan-400 hover:border-[#00d2ff]'
            }`}
          >
            [ ARCHIVE_STATION // MODULES: {dockedWidgets.length} ]
          </button>
        </div>
      </header>

      {/* Main expanded full-width workspace panel */}
      <div className="w-full">
        <ResponsiveReactGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996 }}
          cols={{ lg: 12, md: 12 }}
          rowHeight={50}
          isDraggable={true}
          isResizable={true}
          draggableHandle=".drag-handle"
          margin={[16, 16]}
          onLayoutChange={handleLayoutChange}
          onBreakpointChange={(newBreakpoint) => setCurrentBreakpoint(newBreakpoint)}

          // Native external droppable supports [2]
          isDroppable={droppingWidgetId !== null}
          droppingItem={{ i: droppingWidgetId || 'dropping', w: droppingW, h: droppingH }}
          onDrop={(layout, item) => handleRestoreFromDock(droppingWidgetId, layout, item)}

          // Safe, drag-initiated state-driven detection boundaries [1]
          onDragStart={(layout, oldItem, newItem) => {
            setActiveDragId(newItem.i)
          }}
          onDrag={(layout, oldItem, newItem, placeholder, e) => {
            // Safely verify mouse cursor position using optional chaining to prevent synthetics crashes [1]
            const clientY = e?.clientY || e?.nativeEvent?.clientY || (e?.touches && e?.touches[0]?.clientY)
            if (isDraggingOverBottomBay(e)) {
              if (previewDockingId !== newItem.i) setPreviewDockingId(newItem.i)
            } else {
              if (previewDockingId === newItem.i) setPreviewDockingId(null)
            }
          }}
          onDragStop={(layout, oldItem, newItem, placeholder, e) => {
            if (isDraggingOverBottomBay(e)) {
              handleDockWidget(newItem.i)
            }
            setActiveDragId(null)
            setPreviewDockingId(null)
          }}
        >
          {!dockedWidgets.includes('weather') && (
          <WidgetShell
            key="weather"
            id="weather"
            title="WEATHER MONITOR // NAV_V.02"
            loading={weatherLoading}
            isPreview={previewDockingId === 'weather'}
            previewLabel={renderFolderPreview('WEATHER_MONITOR // NAV_V.02')}
            onDock={() => handleDockWidget('weather')}
            onFocus={() => setFocalWidgetId('weather')}
            onDoubleClickHeader={() => setFocalWidgetId('weather')}
          >
            <WeatherWidget onLoadingChange={setWeatherLoading} />
          </WidgetShell>
        )}

          {/* 2. MARKET DATA & PORTFOLIO TRACKER */}
          {!dockedWidgets.includes('market') && (
          <WidgetShell
            key="market"
            id="market"
            title="FINANCIAL_FEED // SUBNETS_V.02"
            loading={marketLoading}
            isPreview={previewDockingId === 'market'}
            previewLabel={renderFolderPreview('FINANCIAL_FEED // MARKET')}
            onDock={() => handleDockWidget('market')}
            onFocus={() => setFocalWidgetId('market')}
            onDoubleClickHeader={() => setFocalWidgetId('market')}
          >
            {renderSubsystemInnerContent('market')}
          </WidgetShell>
        )}

          {/* 3. CORE CONTROL SYSTEM */}
          {!dockedWidgets.includes('main') && (
          <WidgetShell
            key="main"
            id="main"
            bg="bg-[#0c1821]/40"
            title="CORE_CONTROL_SYSTEM // MAIN_UNIT"
            loading={false}
            isPreview={previewDockingId === 'main'}
            previewLabel={renderFolderPreview('CORE_CONTROL // MAIN_UNIT')}
            onDock={() => handleDockWidget('main')}
            onFocus={() => setFocalWidgetId('main')}
            onDoubleClickHeader={() => setFocalWidgetId('main')}
          >
            {renderSubsystemInnerContent('main')}
          </WidgetShell>
        )}

          {/* 4. NEWS MATRIX */}
          {!dockedWidgets.includes('news') && (
          <WidgetShell
            key="news"
            id="news"
            title="NEWS MATRIX // ROUTER_V.01"
            loading={news.loading}
            isPreview={previewDockingId === 'news'}
            previewLabel={renderFolderPreview('NEWS_MATRIX // RSS')}
            onDock={() => handleDockWidget('news')}
            onFocus={() => setFocalWidgetId('news')}
            onDoubleClickHeader={() => setFocalWidgetId('news')}
          >
            {renderSubsystemInnerContent('news')}
          </WidgetShell>
        )}

          {/* 5. YOUTUBE MEDIA TERMINAL */}
          {!dockedWidgets.includes('social') && (
          <WidgetShell
            key="social"
            id="social"
            title="YOUTUBE_MEDIA_TERMINAL // NODE_05"
            loading={false}
            dotColor="bg-rose-600"
            dotPulse={true}
            isPreview={previewDockingId === 'social'}
            previewLabel={renderFolderPreview('MEDIA_TERMINAL // YOUTUBE')}
            onDock={() => handleDockWidget('social')}
            onFocus={() => setFocalWidgetId('social')}
            onDoubleClickHeader={() => setFocalWidgetId('social')}
          >
            {renderSubsystemInnerContent('social')}
          </WidgetShell>
        )}
          
          {/* 6. OPERATIONAL LOG (TO-DO LIST) */}
          {!dockedWidgets.includes('todo') && (
          <WidgetShell
            key="todo"
            id="todo"
            title="OPERATIONAL_LOG // TO_DO"
            loading={false}
            dotColor="bg-amber-500"
            dotPulse={true}
            className="select-none"
            isPreview={previewDockingId === 'todo'}
            previewLabel={renderFolderPreview('OPERATIONAL_LOG // TO_DO')}
            onDock={() => handleDockWidget('todo')}
            onFocus={() => setFocalWidgetId('todo')}
            onDoubleClickHeader={() => setFocalWidgetId('todo')}
          >
            {renderSubsystemInnerContent('todo')}
          </WidgetShell>
        )}

          {/* 7. ANALYTICAL MATH LAB */}
          {!dockedWidgets.includes('calculator') && (
          <WidgetShell
            key="calculator"
            id="calculator"
            title="ANALYTICAL_MATH_LAB // V_01"
            loading={false}
            dotColor="bg-cyan-500"
            dotPulse={true}
            isPreview={previewDockingId === 'calculator'}
            previewLabel={renderFolderPreview('ANALYTICAL_LAB // MATH_GRAPH')}
            onDock={() => handleDockWidget('calculator')}
            onFocus={() => setFocalWidgetId('calculator')}
            onDoubleClickHeader={() => setFocalWidgetId('calculator')}
          >
            {renderSubsystemInnerContent('calculator')}
          </WidgetShell>
        )}
        </ResponsiveReactGridLayout>
      </div>

      {/* Unified Bottom Drawer & Archive Compartment */}
      <div 
        onDragOver={handleDragOver}
        className={`fixed bottom-0 left-0 right-0 bg-[#090e14]/95 border-t-2 border-[#d07018] shadow-[0_-15px_35px_rgba(0,0,0,0.9)] z-40 p-4 transition-all duration-300 transform${
          activeDragId 
            ? 'h-28 translate-y-0 opacity-100' 
            : isDockOpen 
              ? 'h-40 translate-y-0 opacity-100' 
              : 'h-0 translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        {activeDragId && (
          <div className="flex flex-col justify-center items-center h-full gap-1">
            <div className="text-[11px] font-extrabold tracking-widest text-[#d07018] uppercase animate-pulse">
              [ HUD_ARCHIVE_COMPARTMENT ]
            </div>
            <div className="text-[9px] text-[#60809a] uppercase tracking-wider">
              DROP ACTIVE MODULE HERE TO STORAGE ARCHIVE
            </div>
          </div>
        )}

        {isDockOpen && !activeDragId && (
          <div className="flex flex-col gap-2.5 h-full">
            <div className="flex justify-between items-center border-b border-[#1c3547] pb-2">
              <span className="text-[10px] font-bold text-[#60809a] tracking-widest uppercase">STORAGE_BAY // ARCHIVE_SYSTEM</span>
              <button 
                onClick={() => setIsDockOpen(false)}
                className="text-[9px] font-bold text-rose-500 hover:text-rose-400 cursor-pointer focus:outline-none"
              >
                [ CLOSE_BAY ]
              </button>
            </div>
            
            <div className="flex gap-4 items-center overflow-x-auto pb-2 h-full scrollbar-thin">
              {dockedWidgets.length === 0 ? (
                <div className="text-[10px] text-cyan-700/60 italic py-2 w-full text-center">
                  NO_MODULES_STORED // DRAG ACTIVE MODULES TO BOTTOM COMPARTMENT TO ARCHIVE
                </div>
              ) : (
                dockedWidgets.map(id => {
                  const names = {
                    weather: 'WEATHER_MONITOR // NAV_02',
                    market: 'FINANCIAL_FEED // MARKET',
                    main: 'CORE_CONTROL // MAIN_UNIT',
                    news: 'NEWS_MATRIX // RSS',
                    social: 'MEDIA_TERMINAL // YOUTUBE',
                    todo: 'OPERATIONAL_LOG // TO_DO',
                    calculator: 'ANALYTICAL_LAB // MATH_GRAPH'
                  }
                  const defaultCoord = defaultLayouts.lg.find(item => item.i === id) || { w: 3, h: 4 }

                  return (
                    <div 
                      key={id}
                      draggable={true}
                      unselectable="on"
                      style={{ WebkitUserDrag: 'element' }} // Forces WebKit to recognize the container as a native draggable object [3]
                      onDragStart={(e) => {
                        setDroppingWidgetId(id)
                        setDroppingW(defaultCoord.w)
                        setDroppingH(defaultCoord.h)
                        e.dataTransfer.setData("text/plain", id)
                      }}
                      onDragEnd={() => {
                        setTimeout(() => {
                          setDroppingWidgetId(null)
                          setIsDockOpen(false) 
                        }, 100)
                      }}
                      className="droppable-element flex-shrink-0 bg-[#0c1821]/90 border border-dashed border-cyan-500/40 hover:border-cyan-400 px-4 py-3 rounded flex items-center justify-between gap-4 w-64 h-16 shadow-[0_0_10px_rgba(0,210,255,0.05)] cursor-grab active:cursor-grabbing transition-all"
                      title="DRAG UP ONTO THE WORKSPACE TO DEPLOY"
                    >
                      <div className="flex flex-col gap-0.5 overflow-hidden">
                        <span className="text-[10px] font-black tracking-wider text-cyan-100 truncate">{names[id] || `${id.toUpperCase()}_NODE`}</span>
                        <span className="text-[7.5px] text-[#60809a] tracking-widest uppercase">SIZE: {defaultCoord.w}x{defaultCoord.h} // STATUS: CACHED</span>
                      </div>
                      <div className="text-[8px] text-cyan-400 border border-cyan-500/20 px-1.5 py-0.5 rounded bg-cyan-950/20 select-none uppercase font-bold shrink-0">
                        [ DRAG_UP ]
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Immersive Sub-System Focal Diagnostics Overlay [Option 1.5] */}
      {(focalWidgetId || isClosingFocal) && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center bg-[#090e14]/60 backdrop-blur-[2px] p-6 transition-all duration-300 ${
          isClosingFocal ? 'animate-fadeOverlayOut' : 'animate-fadeOverlay'
        }`}>
          
          {/* Diagnostic Frame Wrapper (Smooth cubic zoom fade scale-up & exit scale-down animation) [3] */}
          <div className={`relative w-[85vw] h-[85vh] max-w-6xl bg-[#0c1821] border-2 border-[#00d2ff] rounded shadow-[0_0_50px_rgba(0,210,255,0.25)] flex flex-col overflow-hidden ${
            isClosingFocal ? 'animate-focalZoomOut' : 'animate-focalZoom'
          }`}>
            
            {/* Sci-Fi Decorative Corner Brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#00d2ff]"></div>
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#00d2ff]"></div>
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#00d2ff]"></div>
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#00d2ff]"></div>

            {/* Immersive Header bar */}
            <div 
              onDoubleClick={handleCloseFocal}
              className="bg-[#132533] border-b border-[#1c3547] px-4 py-2 flex justify-between items-center text-xs font-bold text-[#60809a] select-none cursor-pointer"
              title="DOUBLE-CLICK HEADER TO DISENGAGE FOCUS LOCK"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                <span>FOCUS_TARGET_LOCK: ACTIVE // SYS_DIAG_V.01</span>
              </div>
              <div className="text-[10px] text-cyan-500 flex gap-4">
                <span>LAT: 39.64N // LNG: 27.88E</span>
                <span>RANGE: ISOLATED</span>
              </div>
              <button 
                onClick={handleCloseFocal}
                className="text-rose-500 hover:text-rose-400 font-bold focus:outline-none transition-colors cursor-pointer"
              >
                [ DISENGAGE_FOCUS_LOCK ]
              </button>
            </div>

            {/* Focal Target Body Container */}
            <div className="flex-grow overflow-hidden flex flex-col bg-[#090e14]/50">
              {renderSubsystemInnerContent(focalWidgetId, true)} {/* Passing true prevents grid canvas reference swaps */}
            </div>

            {/* Diagnostic Footer */}
            <div className="bg-[#0e1a24]/30 border-t border-[#1c3547]/50 px-4 py-1.5 text-[8.5px] text-[#60809a] flex justify-between select-none">
              <span>MODULE // {focalWidgetId ? focalWidgetId.toUpperCase() : ''}</span>
              <span>STATE // INTERACTIVE_DIAGNOSTIC_RENDER</span>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default App;

import * as math from 'mathjs'
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { WidthProvider, Responsive as ResponsiveGridLayout } from 'react-grid-layout/legacy'
import WidgetShell from './components/WidgetShell'
import WeatherWidget from './widgets/WeatherWidget'
import TodoWidget from './widgets/TodoWidget'
import CalculatorWidget from './widgets/CalculatorWidget'
import NewsWidget from './widgets/NewsWidget'
import SocialWidget from './widgets/SocialWidget'
import MarketWidget from './widgets/MarketWidget'
import MainWidget from './widgets/MainWidget'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { getCurrentWindow } from '@tauri-apps/api/window' 
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

const ResponsiveReactGridLayout = WidthProvider(ResponsiveGridLayout)

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
  const [graphScale, setGraphScale] = useState(32)
  const [weatherLoading, setWeatherLoading] = useState(true)
  const [newsLoading, setNewsLoading] = useState(true)
  const [marketLoading, setMarketLoading] = useState(true)

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
  const [isGridInteracting, setIsGridInteracting] = useState(false)
  const [previewDockingId, setPreviewDockingId] = useState(null)

  // State-driven Focal Diagnostic isolation controllers [3]
  const [focalWidgetId, setFocalWidgetId] = useState(null)
  const [isClosingFocal, setIsClosingFocal] = useState(false)

  // SocialWidget lives in a single fixed-position floating panel portaled straight into
  // document.body — a container reference that never changes — so it never remounts.
  // Invisible anchor divs in the grid tile and the focal overlay mark where that panel
  // should visually sit; we measure their rects and move the panel to match, instead of
  // ever changing the portal's own container (which would force a remount + reload the
  // iframe, restarting YouTube playback).
  const socialGridAnchorRef = useRef(null)
  const socialFocalAnchorRef = useRef(null)
  const [socialPanelRect, setSocialPanelRect] = useState(null)
  const isSocialFocal = focalWidgetId === 'social'

  const syncSocialPanelRect = useCallback(() => {
    // Docked (and not focal) means the grid anchor has unmounted entirely — there's
    // nowhere for the panel to sit, so hide it instead of leaving it frozen at its
    // last known position, which is what happened before this check existed.
    if (dockedWidgets.includes('social') && !isSocialFocal) {
      setSocialPanelRect(prev => (prev === null ? prev : null))
      return
    }
    const anchor = isSocialFocal ? socialFocalAnchorRef.current : socialGridAnchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    setSocialPanelRect(prev => {
      if (prev && prev.top === rect.top && prev.left === rect.left && prev.width === rect.width && prev.height === rect.height) {
        return prev
      }
      return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    })
  }, [isSocialFocal, dockedWidgets])

  // Synchronous, guaranteed sync the instant focus mode opens/closes — doesn't depend on
  // requestAnimationFrame at all, unlike the continuous tracker below, so the panel snaps
  // to the right place immediately even if rAF is throttled (e.g. an unfocused window).
  // A follow-up sync after the CSS zoom transition's duration catches its settled end
  // state the same way, in case rAF never got a chance to track it continuously.
  useLayoutEffect(() => {
    syncSocialPanelRect()
    const settleId = setTimeout(syncSocialPanelRect, 400)
    return () => clearTimeout(settleId)
  }, [isSocialFocal, isClosingFocal, syncSocialPanelRect])

  // Continuously track the current anchor's on-screen position every frame, so the
  // floating panel follows grid dragging/resizing and the focal overlay's zoom animation
  // alike, instead of only updating on specific events we'd otherwise have to enumerate.
  useEffect(() => {
    let rafId
    const tick = () => {
      syncSocialPanelRect()
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [syncSocialPanelRect])

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

    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focalWidgetId, isClosingFocal, handleCloseFocal])

  // Sizing parameters for elements dragged out of storage back onto grid
  const [droppingWidgetId, setDroppingWidgetId] = useState(null)
  const [droppingW, setDroppingW] = useState(3)
  const [droppingH, setDroppingH] = useState(4)

  // Sync operations
  useEffect(() => {
    localStorage.setItem('dashboardDocked', JSON.stringify(dockedWidgets))
  }, [dockedWidgets])

  useEffect(() => {
    localStorage.setItem('dashboardLastCoords', JSON.stringify(lastCoordinates))
  }, [lastCoordinates])


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
          onLayoutChange={(currentLayout, allLayouts) => {
            handleLayoutChange(currentLayout, allLayouts)
            syncSocialPanelRect()
          }}
          onBreakpointChange={(newBreakpoint) => setCurrentBreakpoint(newBreakpoint)}

          // Native external droppable supports [2]
          isDroppable={droppingWidgetId !== null}
          droppingItem={{ i: droppingWidgetId || 'dropping', w: droppingW, h: droppingH }}
          onDrop={(layout, item) => handleRestoreFromDock(droppingWidgetId, layout, item)}

          // Safe, drag-initiated state-driven detection boundaries [1]
          onDragStart={(layout, oldItem, newItem) => {
            setActiveDragId(newItem.i)
            setIsGridInteracting(true)
          }}
          onDrag={(layout, oldItem, newItem, placeholder, e) => {
            // Safely verify mouse cursor position using optional chaining to prevent synthetics crashes [1]
            const clientY = e?.clientY || e?.nativeEvent?.clientY || (e?.touches && e?.touches[0]?.clientY)
            if (isDraggingOverBottomBay(e)) {
              if (previewDockingId !== newItem.i) setPreviewDockingId(newItem.i)
            } else {
              if (previewDockingId === newItem.i) setPreviewDockingId(null)
            }
            syncSocialPanelRect()
          }}
          onDragStop={(layout, oldItem, newItem, placeholder, e) => {
            if (isDraggingOverBottomBay(e)) {
              handleDockWidget(newItem.i)
            }
            setActiveDragId(null)
            setPreviewDockingId(null)
            setIsGridInteracting(false)
            syncSocialPanelRect()
          }}
          // Keep the social floating panel's size synced live while its grid tile is
          // being resized, not just after — react-grid-layout doesn't otherwise expose
          // this and the panel isn't actually part of this tile's own DOM subtree [3]
          onResizeStart={() => setIsGridInteracting(true)}
          onResize={() => syncSocialPanelRect()}
          onResizeStop={() => {
            setIsGridInteracting(false)
            syncSocialPanelRect()
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
            {focalWidgetId !== 'weather' && <WeatherWidget onLoadingChange={setWeatherLoading} />}
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
            {focalWidgetId !== 'market' && <MarketWidget onLoadingChange={setMarketLoading} />}
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
            {focalWidgetId !== 'main' && <MainWidget />}
          </WidgetShell>
        )}

          {/* 4. NEWS MATRIX */}
          {!dockedWidgets.includes('news') && (
          <WidgetShell
            key="news"
            id="news"
            title="NEWS MATRIX // ROUTER_V.01"
            loading={newsLoading}
            isPreview={previewDockingId === 'news'}
            previewLabel={renderFolderPreview('NEWS_MATRIX // RSS')}
            onDock={() => handleDockWidget('news')}
            onFocus={() => setFocalWidgetId('news')}
            onDoubleClickHeader={() => setFocalWidgetId('news')}
          >
            {focalWidgetId !== 'news' && <NewsWidget onLoadingChange={setNewsLoading} />}
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
            <div ref={socialGridAnchorRef} className="flex-grow flex flex-col overflow-hidden" />
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
              {focalWidgetId !== 'todo' && <TodoWidget />}
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
            {focalWidgetId !== 'calculator' && <CalculatorWidget/>}
          </WidgetShell>
        )}
        </ResponsiveReactGridLayout>
      </div>

      {/* Single persistent SocialWidget instance in a floating panel that's repositioned via
          CSS to match the grid tile or the focal overlay — never remounted, so YouTube
          playback survives toggling focus mode [3] */}
      {socialPanelRect && createPortal(
        <div
          style={{
            position: 'fixed',
            top: socialPanelRect.top,
            left: socialPanelRect.left,
            width: socialPanelRect.width,
            height: socialPanelRect.height,
            zIndex: isSocialFocal ? 55 : 1,
            // This outer box is click-through everywhere by default. It exists only to
            // anchor the interactive inner box below at the right screen position —
            // it isn't actually part of the grid tile's DOM (it's portaled straight
            // into document.body), so without this it would eat every pointer event
            // in the whole tile area, resize handle included.
            pointerEvents: 'none',
            // Smooths the focal zoom transition. Deliberately scoped to focal mode
            // only, not grid dragging/resizing: there the panel must track the mouse
            // 1:1 with zero lag, and a transition risks briefly leaving the panel
            // mispositioned right over the resize handle it's supposed to stay clear
            // of. In focal mode the worst case is a cosmetic mismatch, not a blocked
            // interaction, so it's a safe place to trade a little precision for polish.
            transition: isSocialFocal && !isGridInteracting
              ? 'top 120ms ease-out, left 120ms ease-out, width 120ms ease-out, height 120ms ease-out'
              : 'none',
          }}
        >
          <div
            className="flex flex-col"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              // In the grid (not focal), pull the interactive area back from the
              // bottom-right corner so react-grid-layout's resize handle underneath
              // stays reachable. No pullback needed while focal — nothing else lives
              // in that corner there.
              right: isSocialFocal ? 0 : 24,
              bottom: isSocialFocal ? 0 : 24,
              pointerEvents: 'auto',
            }}
          >
            <SocialWidget />
          </div>
        </div>,
        document.body
      )}

      {/* Unified Bottom Drawer & Archive Compartment */}
      <div 
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
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
              {focalWidgetId === 'weather' ? (
                <WeatherWidget onLoadingChange={setWeatherLoading} />
              ) : focalWidgetId === 'market' ? (
                <MarketWidget onLoadingChange={setMarketLoading} />
              ) : focalWidgetId === 'todo' ? (
                <TodoWidget />
              ) : focalWidgetId === 'calculator' ? (
                <CalculatorWidget />
              ) : focalWidgetId === 'news' ? (
                <NewsWidget onLoadingChange={setNewsLoading} />
              ) : focalWidgetId === 'social' ? (
                <div ref={socialFocalAnchorRef} className="flex-grow flex flex-col overflow-hidden" />
              ) : focalWidgetId === 'main' ? (
                <MainWidget />
              ) : null}
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

import * as math from 'mathjs'
import React, { useState, useEffect, useLayoutEffect, useReducer, useRef, useCallback } from 'react'
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
    { i: 'weather', x: 0, y: 0, w: 3, h: 7, minW: 2, minH: 2 },
    { i: 'market', x: 0, y: 7, w: 3, h: 5, minW: 2, minH: 4 },
    { i: 'social',  x: 3, y: 0, w: 3, h: 6, minW: 2, minH: 3 },
    { i: 'news',   x: 3, y: 6, w: 3, h: 5, minW: 2, minH: 4 },
    { i: 'main',   x: 6, y: 0, w: 6, h: 12, minW: 4, minH: 6 },
    { i: 'todo',   x: 3, y: 11, w: 3, h: 4, minW: 2, minH: 3 },
    { i: 'calculator', x: 0, y: 12, w: 12, h: 8, minW: 4, minH: 5 }
  ],
  md: [
    { i: 'weather', x: 0, y: 0, w: 6, h: 7, minW: 2, minH: 2 },
    { i: 'market', x: 6, y: 0, w: 6, h: 5, minW: 2, minH: 4 },
    { i: 'main',   x: 0, y: 7, w: 12, h: 9, minW: 4, minH: 6 },
    { i: 'news',   x: 0, y: 16, w: 6, h: 7, minW: 2, minH: 4 },
    { i: 'social', x: 6, y: 16, w: 6, h: 5, minW: 2, minH: 3 },
    { i: 'todo',   x: 0, y: 21, w: 6, h: 4, minW: 2, minH: 3 },
    { i: 'calculator', x: 6, y: 21, w: 6, h: 8, minW: 4, minH: 5 }
  ]
}

// ---------------------------------------------------------------------------------------
// Centralized widget layout/visibility state.
//
// This is the single source of truth for three facts that must never drift apart, even
// momentarily: where each widget sits on the grid (layouts), which widgets are hidden in
// the archive drawer (docked), and what size/position a docked widget had right before it
// was archived (lastCoordinates, used to restore it at the same size).
//
// The root cause of the original docking-collapse bug was that these lived in separate
// useState hooks updated via separate setState calls. Even though React batches those
// calls together, a *third* party — react-grid-layout's own onLayoutChange callback, which
// fires with a layout snapshot computed from the pre-update DOM — could dispatch its own
// competing setLayouts in the same batch and win, silently reintroducing a layout entry for
// a widget that had just been marked docked (or the reverse: dropping a freshly-restored
// widget's correctly-sized entry). Patching that with a ref mirror and a suppression window
// worked, but it was defense bolted on after the fact, not a structural guarantee — and it
// didn't do anything for the "hard jump-cut" feel of docking/restoring itself.
//
// A reducer fixes this by construction rather than by vigilance: every dispatch to the same
// reducer is applied strictly in the order it was dispatched, each one computed against the
// *actual* result of the previous one — never against a stale closure, and never racing a
// second writer, because there is only ever one writer (this reducer) for all three facts.
// DOCK_WIDGET and RESTORE_WIDGET each touch layouts + docked (+ lastCoordinates, for dock)
// in one atomic step; LAYOUT_CHANGED — the one path both plain drag/resize *and* react-grid-
// layout's post-dock/post-restore re-settling go through — always filters against the
// current `docked` list as part of the same state, so a stale snapshot can never reintroduce
// a docked widget's entry. This is also the one shared implementation every widget goes
// through; a widget added later needs no bespoke sync logic of its own.
const PLACEHOLDER_IDS = new Set(['__dropping-elem__', 'dropping'])
const isRealLayoutId = (id) => !PLACEHOLDER_IDS.has(id) && !id.startsWith('dropping-')

// Single source for a widget's fallback size/min-constraints at a given breakpoint — every
// place that previously did its own "look it up in defaultLayouts, or fall back to some
// hardcoded {w,h,minW,minH}" (RESTORE_WIDGET for both the dropped-on breakpoint and the
// other one, plus the archive tray's size label/drag-preview sizing in the JSX below) goes
// through this instead, so a widget added later needs only a defaultLayouts entry — no
// bespoke fallback logic anywhere else.
function getDefaultLayoutItem(id, breakpoint) {
  const found = defaultLayouts[breakpoint]?.find(d => d.i === id) || defaultLayouts.lg?.find(d => d.i === id)
  return found
    ? { w: found.w, h: found.h, minW: found.minW ?? 2, minH: found.minH ?? 3 }
    : { w: 3, h: 4, minW: 2, minH: 3 }
}

// The one function that turns "some item, possibly missing, possibly from an untrusted
// source (react-grid-layout's own report, or whatever was in localStorage)" into a layout
// entry that's safe to keep — used both on initial load (to self-heal anything already
// corrupted in storage from before this validation existed) and on every LAYOUT_CHANGED
// dispatch (to reject a bad live report before it's ever written to state in the first
// place). A missing item, or one whose w/h violates the widget's own configured minimum
// (impossible from a real user resize — react-resizable enforces that client-side — so only
// reachable via a bogus/transient react-grid-layout snapshot), falls back to a known-good
// value; anything else passes through with minW/minH re-asserted from the registry rather
// than trusted from the input, so those two fields specifically can never drift or go missing.
// Deliberately *clamps* rather than rejects-and-reverts: an earlier version of this
// substituted the widget's last known-good item wholesale whenever a report violated its
// minimum, which seemed safer but wasn't — reverting to a stale x/y can conflict with where
// react-grid-layout's own compaction has since moved other widgets, and react-grid-layout
// responds to a layouts prop that contradicts its own compaction by recomputing and firing
// onLayoutChange again; if that recomputation is *also* bogus, the reducer reverts again,
// react-grid-layout recomputes again, and neither side ever converges — an infinite render
// loop, reproduced during exactly the heavy dock/restore churn this function exists to
// harden against. Clamping only the size, and only up to this widget's own configured
// minimum, never disagrees with react-grid-layout about *position* — nothing here can ever
// conflict with its own compaction, so there's nothing for it to "correct" by recomputing.
function sanitizeLayoutItem(item, id, breakpoint) {
  const { minW, minH } = getDefaultLayoutItem(id, breakpoint)
  if (!item) {
    const def = defaultLayouts[breakpoint]?.find(d => d.i === id) || defaultLayouts.lg.find(d => d.i === id)
    return def ? { ...def, minW, minH } : { i: id, x: 0, y: 0, w: minW, h: minH, minW, minH }
  }
  if (item.w < minW || item.h < minH) {
    return { ...item, w: Math.max(item.w, minW), h: Math.max(item.h, minH), minW, minH }
  }
  // Valid item: return it completely unchanged — same object reference react-grid-layout
  // itself reported, not a reconstructed lookalike. LAYOUT_CHANGED fires on every drag,
  // resize, and internal re-settle; unconditionally rebuilding every item on every one of
  // those (even when nothing about it actually needed correcting) turned out to matter more
  // than it looked like it should: react-grid-layout re-fired onLayoutChange in response,
  // this rebuilt everything again, and so on — a permanent, not just occasional, infinite
  // render loop. Touching only the rare genuinely-bogus item is enough to enforce the
  // invariant and avoids that feedback loop entirely.
  return item
}

// Pushes anything overlapping `blockerId` straight down to sit just below it, cascading to
// anything THAT then overlaps too, until nothing does (capped, just in case). Confirmed by
// logging every write to storage during a real restore: react-grid-layout's own onDrop
// `layout` param places the newly-restored widget but does NOT yet reflect the other
// widgets moving out of its way — that arrives a render or two later, via a follow-up
// onLayoutChange, once react-grid-layout's own compaction has run. Committing the
// in-between state (as RESTORE_WIDGET otherwise would, holding every other widget at its
// pre-restore position while the incoming one already occupies the same cells) was the
// visible overlap the user kept hitting — real, not just theoretical: two writes to
// localStorage in a row measurably contained an actual overlapping pair before a third,
// react-grid-layout-driven write corrected it. This doesn't need to match react-grid-
// layout's own denser, gap-filling compaction — only needs to guarantee zero overlap for
// the one render before that follow-up onLayoutChange takes over and settles things
// properly, which happens within the same interaction regardless.
function resolveOverlaps(items, blockerId) {
  const byId = new Map(items.map(i => [i.i, { ...i }]))
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  let changed = true
  let guard = 0
  while (changed && guard < 100) {
    changed = false
    guard++
    for (const item of byId.values()) {
      if (item.i === blockerId) continue
      for (const other of byId.values()) {
        if (other.i === item.i) continue
        if (overlaps(item, other)) {
          const pushedY = other.y + other.h
          if (pushedY > item.y) {
            item.y = pushedY
            changed = true
          }
        }
      }
    }
  }
  return Array.from(byId.values())
}

function layoutReducer(state, action) {
  switch (action.type) {
    // The one path for every layout-affecting event react-grid-layout reports — a plain
    // drag, a resize, or its own re-settling right after a dock/restore. Filtering against
    // `state.docked` here (not a ref, not a prop closure) is what guarantees a stale
    // snapshot from that re-settling can never reintroduce a docked widget's layout entry:
    // this reducer call sees whatever DOCK_WIDGET/RESTORE_WIDGET last committed, always,
    // because dispatches to one reducer are never processed out of order.
    //
    // Two more things this validates before trusting react-grid-layout's report, discovered
    // under heavy dock/restore churn (many operations in quick succession): react-grid-
    // layout occasionally reports an item it's synthesizing fresh internally — mid re-settle,
    // not from any real user drag/resize — with no minW/minH at all and a degenerate 1x1
    // size. sanitizeLayoutItem clamps that up to the widget's own configured minimum rather
    // than rejecting it outright (see that function's comment for why rejecting-and-
    // reverting caused an infinite render loop instead of fixing anything). Separately, a
    // report can omit a widget entirely (react-grid-layout only reports the breakpoint(s) it
    // currently has state for) — previously-known, non-docked widgets are carried forward
    // rather than silently dropped when that happens.
    case 'LAYOUT_CHANGED': {
      const cleaned = {}
      Object.keys(action.allLayouts).forEach(bp => {
        const prevById = new Map((state.layouts[bp] || []).map(item => [item.i, item]))

        const accepted = action.allLayouts[bp]
          .filter(item => isRealLayoutId(item.i) && !state.docked.includes(item.i))
          .map(item => sanitizeLayoutItem(item, item.i, bp))

        const reportedIds = new Set(accepted.map(item => item.i))
        prevById.forEach((item, id) => {
          if (!reportedIds.has(id) && !state.docked.includes(id)) accepted.push(item)
        })

        cleaned[bp] = accepted
      })
      return { ...state, layouts: cleaned }
    }

    // Atomically: remember the widget's current spot (for restoring at the same size
    // later), drop its entry from every breakpoint's layout, and mark it docked — one
    // state transition, so there is no render in which it's simultaneously "not in
    // layouts" and "not yet in docked" or vice versa.
    case 'DOCK_WIDGET': {
      const { id, breakpoint } = action
      if (state.docked.includes(id)) return state
      const currentItem = state.layouts[breakpoint]?.find(item => item.i === id)
        || state.layouts.lg?.find(item => item.i === id)
        || defaultLayouts.lg.find(item => item.i === id)

      const nextLayouts = {}
      Object.keys(state.layouts).forEach(bp => {
        nextLayouts[bp] = state.layouts[bp].filter(item => item.i !== id)
      })

      return {
        ...state,
        layouts: nextLayouts,
        docked: [...state.docked, id],
        lastCoordinates: currentItem
          ? { ...state.lastCoordinates, [id]: currentItem }
          : state.lastCoordinates
      }
    }

    // Atomically: unmark the widget as docked and place it back into the active
    // breakpoint's layout at react-grid-layout's collision-resolved drop position (`layout`
    // is RGL's freshly-recalculated array for the current breakpoint, already accounting
    // for anything that had to shift to make room — that's the "layoutItem" contract
    // onDrop hands back). The other breakpoint doesn't have a live RGL computation for this
    // drop, so it gets the same x/y/w/h applied against whatever that breakpoint's layout
    // already was, same as the current breakpoint's fallback minW/minH sourcing.
    case 'RESTORE_WIDGET': {
      const { id, breakpoint, layoutItem } = action
      if (!state.docked.includes(id)) return state
      const bp = breakpoint || 'lg'
      const nextLayouts = { ...state.layouts }

      const constraints = getDefaultLayoutItem(id, bp)
      const restoredItem = {
        i: id,
        x: layoutItem.x,
        y: layoutItem.y,
        w: layoutItem.w,
        h: layoutItem.h,
        minW: constraints.minW,
        minH: constraints.minH
      }
      // This widget's own entry uses react-grid-layout's collision-resolved drop position
      // directly; every *other* widget starts from wherever it already was in state — NOT
      // from react-grid-layout's onDrop `layout` param, which (confirmed by logging every
      // write to storage during a real restore) places the new item without yet reflecting
      // the others moving out of its way on a disruptive drop. But "leave them where they
      // already are" isn't sufficient by itself: if the restored widget lands on a cell one
      // of them already occupies (e.g. dropped at the very top, where a widget already sits
      // by default), that's *still* an overlap — just one made of stale data instead of
      // react-grid-layout's premature data. resolveOverlaps pushes anything the restored
      // widget now overlaps out of its way ourselves, synchronously, so the very first
      // render is already valid — not waiting on react-grid-layout's own follow-up
      // onLayoutChange (which does still fire right after and settle things into its own,
      // denser compaction, same as always) to fix what would otherwise be a real, briefly
      // persisted overlap.
      nextLayouts[bp] = resolveOverlaps([
        ...(state.layouts[bp] || []).filter(item => item.i !== id),
        restoredItem
      ], id)

      const otherBp = bp === 'lg' ? 'md' : 'lg'
      if (nextLayouts[otherBp]) {
        const otherConstraints = getDefaultLayoutItem(id, otherBp)
        nextLayouts[otherBp] = [
          ...nextLayouts[otherBp].filter(item => item.i !== id),
          { i: id, x: layoutItem.x, y: layoutItem.y, w: layoutItem.w, h: layoutItem.h, minW: otherConstraints.minW, minH: otherConstraints.minH }
        ]
      }

      return {
        ...state,
        layouts: nextLayouts,
        docked: state.docked.filter(w => w !== id)
      }
    }

    default:
      return state
  }
}

function initLayoutState() {
  const savedLayouts = localStorage.getItem('dashboardLayouts')
  const savedDocked = localStorage.getItem('dashboardDocked')
  const savedLastCoords = localStorage.getItem('dashboardLastCoords')
  const docked = savedDocked ? JSON.parse(savedDocked) : []
  const dockedSet = new Set(docked)

  const savedLayoutsParsed = savedLayouts ? JSON.parse(savedLayouts) : {}
  const layouts = {}

  // defaultLayouts.lg is the authoritative registry of every widget that exists. Every one
  // of them, for every breakpoint, is regenerated here through the same sanitizeLayoutItem
  // LAYOUT_CHANGED uses — so a widget missing entirely (added after this data was saved, or
  // a breakpoint that's never actually been visited) gets seeded from its default, and one
  // that's *present* but corrupted (e.g. localStorage written by a build from before this
  // validation existed) gets repaired, in the same pass and by the same rule, instead of
  // each widget needing its own "if missing, push default" line added by hand as it was
  // introduced (which is how this used to work, and why the weather-specific minH override
  // lived here too — that's now just weather's entry in defaultLayouts itself, the one place
  // per-widget config belongs). A currently-docked widget is deliberately skipped — it
  // correctly has no layout entry at all.
  const widgetIds = defaultLayouts.lg.map(item => item.i)
  Object.keys(defaultLayouts).forEach(bp => {
    const byId = new Map((savedLayoutsParsed[bp] || []).map(item => [item.i, item]))
    layouts[bp] = widgetIds
      .filter(id => !dockedSet.has(id))
      .map(id => sanitizeLayoutItem(byId.get(id), id, bp))
  })

  return {
    layouts,
    docked,
    lastCoordinates: savedLastCoords ? JSON.parse(savedLastCoords) : {}
  }
}

function App() {
  window.__renderCount = (window.__renderCount || 0) + 1

  const toggleFullscreen = async () => {
    const win = getCurrentWindow()
    const isFs = await win.isFullscreen()
    await win.setFullscreen(!isFs)
  }
  const [graphScale, setGraphScale] = useState(32)
  const [weatherLoading, setWeatherLoading] = useState(true)
  const weatherWidgetRef = useRef(null)
  const [isWeatherRefreshing, setIsWeatherRefreshing] = useState(false)
  const [newsLoading, setNewsLoading] = useState(true)
  const [marketLoading, setMarketLoading] = useState(true)

  // Track the active breakpoint to safely resolve dropping coordinates
  const [currentBreakpoint, setCurrentBreakpoint] = useState('lg')

  // Single source of truth for widget position/size (layouts), archive-drawer visibility
  // (docked), and the size to restore a docked widget at (lastCoordinates) — see the
  // layoutReducer definition above for why these live together instead of as separate
  // useState hooks.
  const [layoutState, dispatchLayout] = useReducer(layoutReducer, undefined, initLayoutState)
  const { layouts, docked: dockedWidgets, lastCoordinates } = layoutState

  // Widget currently mid-fade-out on its way to being docked — kept outside the reducer
  // since it's purely presentational (never persisted): the widget stays fully present in
  // `layouts` until the fade finishes and DOCK_WIDGET actually dispatches, so the fade and
  // the data change are sequenced (fade first, then the rest of the grid reflows into the
  // freed space) rather than fighting for the same instant. See dockWidget below.
  const [closingWidgetId, setClosingWidgetId] = useState(null)

  // States for To-Do drag-and-drop sorting & inline editing
  const [draggedTodoId, setDraggedTodoId] = useState(null)
  const [editingTodoId, setEditingTodoId] = useState(null)
  const [editingTodoValue, setEditingTodoValue] = useState('')

  const [isDockOpen, setIsDockOpen] = useState(false)
  const [activeDragId, setActiveDragId] = useState(null)
  const [isGridInteracting, setIsGridInteracting] = useState(false)
  const [previewDockingId, setPreviewDockingId] = useState(null)

  // Archive drawer is now hover-triggered rather than click-toggled: resting the cursor on
  // the corner trigger for ~0.9s opens it, and it stays open for as long as the cursor
  // remains anywhere on the trigger or the drawer itself, closing shortly after it leaves
  // both. Two independent timers (open-delay vs. close-grace) rather than one, since they
  // guard different things — the open delay is the deliberate "hold to open" gesture, while
  // the close grace is just enough slack to move the cursor between the trigger and the
  // drawer without the drawer slamming shut in between.
  const dockOpenTimerRef = useRef(null)
  const dockCloseTimerRef = useRef(null)
  useEffect(() => () => {
    clearTimeout(dockOpenTimerRef.current)
    clearTimeout(dockCloseTimerRef.current)
  }, [])
  const handleDockAreaEnter = () => {
    clearTimeout(dockCloseTimerRef.current)
    if (isDockOpen) return
    clearTimeout(dockOpenTimerRef.current)
    dockOpenTimerRef.current = setTimeout(() => setIsDockOpen(true), 900)
  }
  const handleDockAreaLeave = () => {
    clearTimeout(dockOpenTimerRef.current)
    if (!isDockOpen) return
    clearTimeout(dockCloseTimerRef.current)
    dockCloseTimerRef.current = setTimeout(() => setIsDockOpen(false), 250)
  }

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

  // Safety net for the archive-drawer HUD getting stuck open. The tray's restore-drag is
  // the only native HTML5 drag in this component (react-grid-layout's own internal
  // dragging is mouse-based via react-draggable, not HTML5 DnD), so a native 'dragend'
  // always fires on it exactly once when the gesture ends — success, cancel, or dropped
  // somewhere invalid — and bubbles to window regardless of which branch of
  // restoreWidgetFromDock (or none at all) actually ran. Clearing the drag-transient state
  // here guarantees the HUD can't outlive the gesture that opened it, instead of relying on
  // every individual handler to remember to reset all of it.
  useEffect(() => {
    const clearDragState = () => {
      setActiveDragId(null)
      setPreviewDockingId(null)
      setDroppingWidgetId(null)
      // Deferred, not immediate: 'dragend' fires right after 'drop' on the very same
      // gesture, so a successful restore's own settle-window guard (see
      // restoreWidgetFromDock) would otherwise get wiped out the instant it's set. Clearing
      // state that's already null is a no-op, so this costs nothing when nothing was stuck.
      setTimeout(() => {
        droppingWidgetIdRef.current = null
      }, 400)
    }
    window.addEventListener('dragend', clearDragState)
    return () => window.removeEventListener('dragend', clearDragState)
  }, [])

  // Same safety net, for the other kind of drag: react-grid-layout's own mouse-based
  // dragging of a widget already on the grid (toward the archive bay, or just to reposition
  // it). Its own onDragStop is the normal path that clears activeDragId/previewDockingId,
  // but a malformed or interrupted mouse sequence — a mouseup that its internal listener
  // doesn't end up recognizing as the end of the session it started, for whatever reason —
  // can leave both stuck indefinitely, wedging the HUD open in its "drop here" state with no
  // way out. Deferred slightly so the normal onDragStop path (should it fire) runs and
  // settles first; clearing state that's already null is a no-op, so this costs nothing on
  // the overwhelming majority of drags where nothing was ever stuck.
  useEffect(() => {
    const clearStuckDragState = () => {
      setTimeout(() => {
        setActiveDragId(null)
        setPreviewDockingId(null)
      }, 60)
    }
    window.addEventListener('mouseup', clearStuckDragState)
    return () => window.removeEventListener('mouseup', clearStuckDragState)
  }, [])

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
  // Mirrors droppingWidgetId synchronously, for the same reason dockedWidgetsRef mirrors
  // dockedWidgets — see handleLayoutChange, which needs to know "is a restore-drag currently
  // hovering the grid" at the instant react-grid-layout's own onLayoutChange fires, not at
  // whatever point the last render happened to commit.
  const droppingWidgetIdRef = useRef(null)

  // Sync operations — each fires only when the sub-field it targets actually changes,
  // since layoutReducer returns a new reference for a sub-field only when that sub-field
  // itself changed (e.g. dispatching DOCK_WIDGET doesn't touch lastCoordinates unless the
  // docked widget had a locatable layout entry, so that effect is a no-op then).
  useEffect(() => {
    localStorage.setItem('dashboardDocked', JSON.stringify(dockedWidgets))
  }, [dockedWidgets])

  useEffect(() => {
    localStorage.setItem('dashboardLastCoords', JSON.stringify(lastCoordinates))
  }, [lastCoordinates])

  useEffect(() => {
    localStorage.setItem('dashboardLayouts', JSON.stringify(layouts))
  }, [layouts])

  // The one handler for every layout-affecting event react-grid-layout reports — plain
  // drag, resize, or its own re-settling after a dock/restore. See layoutReducer's
  // LAYOUT_CHANGED case for why this can no longer reintroduce a docked widget's entry.
  //
  // Restoring is the other reflow glitch this class of bug had left, and it's a different
  // mechanism than docking's: dockWidget drags an *existing* grid child with react-grid-
  // layout's own mouse-based dragging, but restoring drops in a widget that isn't a child at
  // all yet, via react-grid-layout's external-droppable machinery (isDroppable/droppingItem
  // below). While that drop target is just hovering — every pointer move, well before the
  // user actually releases — react-grid-layout fires this same onLayoutChange with a
  // *hypothetical* layout: how everything would shift to make room for the incoming widget
  // at wherever it's hovering right now, not a settled result. Committing that mid-hover, on
  // every pointer move, is exactly what looked like the other widgets flickering/reflowing
  // during a restore — and if the drop then lands somewhere else, or is cancelled outside a
  // valid target altogether, they're left shifted to make room for a preview that never
  // actually happened. restoreWidgetFromDock's own RESTORE_WIDGET dispatch, using react-grid-
  // layout's actual collision-resolved result *at the moment of drop*, is the only thing that
  // should ever commit a restore's effect on the rest of the grid — so layout-changed reports
  // are ignored entirely for the duration of a pending restore-drag.
  const handleLayoutChange = (currentLayout, allLayouts) => {
    if (droppingWidgetIdRef.current !== null) return
    dispatchLayout({ type: 'LAYOUT_CHANGED', allLayouts })
  }

  // State-driven Bottom Storage Compartment docking (Consolidate modules) [1]. The actual
  // DOCK_WIDGET dispatch is deferred until the fade-out plays, not fired immediately: while
  // `closingWidgetId === id`, the widget is still fully present in `layouts` (still
  // occupying its grid cell, just fading in place via WidgetShell's `isClosing` prop), so
  // the rest of the grid doesn't reflow into the freed space until the fade is actually
  // done — sequencing "this widget leaves" before "everything else slides over," rather
  // than both happening in the same instant.
  const dockWidget = (id) => {
    if (dockedWidgets.includes(id) || closingWidgetId === id) return
    setPreviewDockingId(null)
    setIsDockOpen(false)
    setClosingWidgetId(id)
    setTimeout(() => {
      dispatchLayout({ type: 'DOCK_WIDGET', id, breakpoint: currentBreakpoint || 'lg' })
      setClosingWidgetId(null)
    }, 220)
  }

  // Restore dropped widget onto target grid space [1]. Unlike docking, this dispatches
  // immediately — `layoutItem` is react-grid-layout's own placement for this exact drop and
  // only exists in this callback, so there's nothing to defer. The entrance fade is handled
  // by WidgetShell itself on mount (see its `mounted` state), not tracked here. Note this
  // deliberately does NOT use react-grid-layout's `layout` param (every other widget's
  // reported position) — see RESTORE_WIDGET's comment for why that turned out to be
  // unreliable on a disruptive drop.
  const restoreWidgetFromDock = (id, _layout, layoutItem) => {
    const targetId = id || droppingWidgetId
    if (!targetId) return

    setDroppingWidgetId(null)
    setIsDockOpen(false)
    setActiveDragId(null)
    setPreviewDockingId(null)

    if (!layoutItem) {
      droppingWidgetIdRef.current = null
      return
    }

    dispatchLayout({ type: 'RESTORE_WIDGET', id: targetId, breakpoint: currentBreakpoint || 'lg', layoutItem })

    // Keep blocking handleLayoutChange for a moment after the restore too, not just during
    // the hover leading up to it. RESTORE_WIDGET's resolveOverlaps already lands on an
    // overlap-free layout, but react-grid-layout runs its own compaction on top of whatever
    // layout it's given, which doesn't always agree with resolveOverlaps' simpler push-down
    // placement — each disagreement bounces back through onLayoutChange, which without this
    // guard gets written straight to state and re-rendered, prompting RGL to compact again,
    // and so on. Ignoring RGL's own follow-up reports for a short settle window lets it
    // finish reconciling internally without any of that back-and-forth touching our state.
    setTimeout(() => {
      droppingWidgetIdRef.current = null
    }, 400)
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
    <div className="min-h-screen bg-[#090e14] text-[#00d2ff] font-sans px-6 pb-6 pt-14 relative overflow-x-hidden font-sans">
      
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
        /* react-grid-layout's default placeholder (imported above) is a barely-visible dim
           red box — nearly invisible against this dark theme. Overridden here so the tile a
           dragged widget will land in reads clearly while dragging or restoring from dock. */
        @keyframes gridPlaceholderPulse {
          0%, 100% { box-shadow: 0 0 14px rgba(0, 210, 255, 0.45), inset 0 0 14px rgba(0, 210, 255, 0.12); }
          50% { box-shadow: 0 0 30px rgba(0, 210, 255, 0.75), inset 0 0 26px rgba(0, 210, 255, 0.22); }
        }
        .react-grid-placeholder {
          background: rgba(0, 210, 255, 0.2) !important;
          border: 2px dashed #00d2ff !important;
          border-radius: 4px !important;
          opacity: 1 !important;
          animation: gridPlaceholderPulse 1s ease-in-out infinite;
        }
        /* react-grid-layout's own .react-grid-item transitions left/top/width/height (or
           transform/width/height with cssTransforms, which this app uses) at 200ms — that's
           what makes the *other* widgets reflow smoothly around a dock/undock instead of
           jump-cutting. Widening the transitioned-property list to also include opacity
           (rather than adding a second, separately-timed transition) lets WidgetShell's own
           mount fade-in and dock fade-out ride the exact same transition, so a widget
           appearing/disappearing and its neighbors sliding into place read as one motion
           instead of two animations racing each other. Left untouched during an active
           drag/resize (react-grid-layout's own .react-draggable-dragging/.resizing rules
           already set transition: none there, and those rules still win by being the more
           specific/later shorthand) — this only affects the settled, reflowing state. */
        .react-grid-item {
          transition-property: left, top, width, height, opacity !important;
        }
        .react-grid-item.cssTransforms {
          transition-property: transform, width, height, opacity !important;
        }
      `}</style>

      {/* Fullscreen trigger — fixed top-right corner, click-to-toggle. Its bottom edge is the
          reference line the workspace's top padding (pt-14 on the root div, see above) is
          set to sit tangent to, now that the old header bar above it is gone. */}
      <button
        onClick={toggleFullscreen}
        title="TOGGLE FULLSCREEN"
        className="fixed top-4 right-4 z-50 w-9 h-9 flex items-center justify-center rounded border border-[#1c3547] bg-[#090e14]/90 text-[#60809a] hover:text-cyan-400 hover:border-[#00d2ff] transition-all cursor-pointer focus:outline-none"
      >
        <span className="text-sm">⤢</span>
      </button>

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
          onDrop={(layout, item) => restoreWidgetFromDock(droppingWidgetId, layout, item)}

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
              dockWidget(newItem.i)
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
            isClosing={closingWidgetId === 'weather'}
            previewLabel={renderFolderPreview('WEATHER_MONITOR // NAV_V.02')}
            onDock={() => dockWidget('weather')}
            onFocus={() => setFocalWidgetId('weather')}
            onDoubleClickHeader={() => setFocalWidgetId('weather')}
            headerActions={
              <button
                onClick={() => weatherWidgetRef.current?.refresh()}
                disabled={isWeatherRefreshing}
                title="FORCE_REFRESH"
                className="hover:text-cyan-400 font-bold focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-wait"
              >
                <span className={isWeatherRefreshing ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
              </button>
            }
          >
            {focalWidgetId !== 'weather' && (
              <WeatherWidget
                ref={weatherWidgetRef}
                onLoadingChange={setWeatherLoading}
                onRefreshingChange={setIsWeatherRefreshing}
                showHeaderRefresh={false}
              />
            )}
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
            isClosing={closingWidgetId === 'market'}
            previewLabel={renderFolderPreview('FINANCIAL_FEED // MARKET')}
            onDock={() => dockWidget('market')}
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
            isClosing={closingWidgetId === 'main'}
            previewLabel={renderFolderPreview('CORE_CONTROL // MAIN_UNIT')}
            onDock={() => dockWidget('main')}
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
            isClosing={closingWidgetId === 'news'}
            previewLabel={renderFolderPreview('NEWS_MATRIX // RSS')}
            onDock={() => dockWidget('news')}
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
            isClosing={closingWidgetId === 'social'}
            previewLabel={renderFolderPreview('MEDIA_TERMINAL // YOUTUBE')}
            onDock={() => dockWidget('social')}
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
            isClosing={closingWidgetId === 'todo'}
            previewLabel={renderFolderPreview('OPERATIONAL_LOG // TO_DO')}
            onDock={() => dockWidget('todo')}
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
            isClosing={closingWidgetId === 'calculator'}
            previewLabel={renderFolderPreview('ANALYTICAL_LAB // MATH_GRAPH')}
            onDock={() => dockWidget('calculator')}
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

      {/* Small square archive trigger — always present, bottom-left corner. Hover it for
          ~0.9s to open the drawer below; lights up amber whenever modules are stored.
          Rides up on top of the drawer as it opens (translateY matches the drawer's own
          h-28/h-40 height below, on the same transition), so it reads as a tab attached to
          the drawer's top edge rather than a separate fixed button that stays put while the
          drawer slides out from under it. */}
      <button
        onMouseEnter={handleDockAreaEnter}
        onMouseLeave={handleDockAreaLeave}
        title="HOLD TO OPEN ARCHIVE STATION"
        style={{ transform: `translateY(-${activeDragId ? 112 : isDockOpen ? 160 : 0}px)` }}
        className={`fixed bottom-0 left-4 z-50 w-10 h-11 flex items-center justify-center rounded-t border border-b-0 text-sm transition-all duration-300 cursor-pointer focus:outline-none ${
          dockedWidgets.length > 0
            ? 'bg-[#d07018]/15 border-[#d07018] text-[#d07018] shadow-[0_0_10px_rgba(208,112,24,0.35)] animate-pulse'
            : 'bg-[#090e14]/90 border-[#1c3547] text-[#60809a]'
        }`}
      >
        ▲
      </button>

      {/* Unified Bottom Drawer & Archive Compartment */}
      <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onMouseEnter={handleDockAreaEnter}
        onMouseLeave={handleDockAreaLeave}
        className={`fixed bottom-0 left-0 right-0 bg-[#090e14]/95 border-t-2 border-[#d07018] shadow-[0_-15px_35px_rgba(0,0,0,0.9)] z-40 p-4 transition-all duration-300 transform ${
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
                onClick={() => {
                  clearTimeout(dockOpenTimerRef.current)
                  clearTimeout(dockCloseTimerRef.current)
                  setIsDockOpen(false)
                }}
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
                  // Prefer the size the widget actually had right before it was docked
                  // (saved by dockWidget) over the hardcoded default — otherwise
                  // restoring silently discards any resize the user made before docking it.
                  const defaultCoord = lastCoordinates[id] || getDefaultLayoutItem(id, 'lg')

                  return (
                    <div 
                      key={id}
                      draggable={true}
                      unselectable="on"
                      style={{ WebkitUserDrag: 'element' }} // Forces WebKit to recognize the container as a native draggable object [3]
                      onDragStart={(e) => {
                        // Set synchronously (not just via setDroppingWidgetId) so
                        // handleLayoutChange sees this hover starting immediately, even if
                        // react-grid-layout's own dragover-driven onLayoutChange fires before
                        // React re-renders with the new state.
                        droppingWidgetIdRef.current = id
                        setDroppingWidgetId(id)
                        setDroppingW(defaultCoord.w)
                        setDroppingH(defaultCoord.h)
                        e.dataTransfer.setData("text/plain", id)
                      }}
                      onDragEnd={() => {
                        setTimeout(() => {
                          droppingWidgetIdRef.current = null
                          setDroppingWidgetId(null)
                          clearTimeout(dockOpenTimerRef.current)
                          clearTimeout(dockCloseTimerRef.current)
                          setIsDockOpen(false)
                          setActiveDragId(null)
                          setPreviewDockingId(null)
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
                <MarketWidget onLoadingChange={setMarketLoading} isFocused />
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

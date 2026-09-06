import React, { useEffect, useState } from 'react'
import WidgetErrorBoundary from './WidgetErrorBoundary'
import ReticleCorner from './ReticleCorner'

const WidgetShell = React.forwardRef(function WidgetShell(
  {
    id,
    title,
    loading,
    bg = 'bg-[#0c1821]',
    dotColor,
    dotPulse = false,
    isPreview,
    previewLabel,
    onDock,
    onFocus,
    onDoubleClickHeader,
    headerActions,
    isClosing = false,
    children,
    className = '',
    style,
    ...rest
  },
  ref
) {
  // Every widget fades in on mount — restored from the archive, or (for any widget added
  // later) simply appearing for the first time — with no per-widget wiring required.
  // Starts invisible and flips to visible one frame later, via requestAnimationFrame, so
  // the browser actually has an opacity value to transition *from* instead of the element
  // just popping straight to fully visible on its first paint. Pairs with the opacity entry
  // App.jsx adds to .react-grid-item's own transitioned-property list, so this rides
  // react-grid-layout's normal 200ms reflow transition rather than a second, separately-
  // timed one.
  const [isMounted, setIsMounted] = useState(false)
  useEffect(() => {
    const rafId = requestAnimationFrame(() => setIsMounted(true))
    return () => cancelAnimationFrame(rafId)
  }, [])

  // isClosing wins over the mount fade: App.jsx holds this widget in `layouts` for 220ms
  // after dockWidget() is called specifically so this opacity transition has time to play
  // *before* the DOCK_WIDGET dispatch actually removes it and the rest of the grid reflows.
  const opacity = isClosing ? 0 : (isMounted ? 1 : 0)

  return (
    <div
      ref={ref}
      data-widget-id={id}
      style={{ ...style, opacity }}
      className={`${bg} hud-surface relative hud-scanline border border-[#1c3547] flex flex-col overflow-hidden ${className}`}
      {...rest}
    >
      {/* Targeting-reticle corners — the app's shared "HUD frame" signature, applied here
          once so every widget (present and future) gets it automatically instead of each
          needing its own copy (previously only the focus overlay had this). */}
      <ReticleCorner corner="tl" className="text-cyan-400/70 z-20 m-0.5" />
      <ReticleCorner corner="tr" className="text-cyan-400/70 z-20 m-0.5" />
      <ReticleCorner corner="bl" className="text-cyan-400/70 z-20 m-0.5" />
      <ReticleCorner corner="br" className="text-cyan-400/70 z-20 m-0.5" />

      {isPreview ? (
        previewLabel
      ) : (
        <>
          <div
            onDoubleClick={onDoubleClickHeader}
            className="relative drag-handle cursor-grab active:cursor-grabbing px-3 py-1.5 bg-[#132533] border-b border-[#1c3547] text-[9px] text-[#60809a] font-bold flex justify-between items-center select-none"
            title="DOUBLE-CLICK HEADER TO ENGAGE TARGET DIALOG FOCUS"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={`hud-dot w-1.5 h-1.5 rounded-full shrink-0 ${
                  loading
                    ? 'bg-amber-500 animate-pulse'
                    : `${dotColor || 'bg-[#00d2ff]'} ${dotPulse ? 'animate-pulse' : ''}`
                }`}></span>
              <span className="font-display text-[8.5px] tracking-wide truncate">{title}</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-hud-mono shrink-0">
              {headerActions && (
                <span onClick={(e) => e.stopPropagation()} className="flex items-center">
                  {headerActions}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDock() }}
                className="hover:text-amber-500 leading-none focus:outline-none cursor-pointer"
                title="DOCK MODULE"
              >
                ⤳
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onFocus() }}
                className="hover:text-cyan-400 leading-none focus:outline-none cursor-pointer"
                title="ENGAGE FOCUS MATRIX"
              >
                ⤖
              </button>
            </div>
            {/* Slow light band drifting through the header, distinct from the vertical
                scanline over the panel body below — a low-key "actively fed" tell. */}
            <div className="absolute left-0 right-0 bottom-0 h-px hud-header-flow"></div>
          </div>
          <WidgetErrorBoundary widgetName={title}>
            {children}
          </WidgetErrorBoundary>
        </>
      )}
    </div>
  )
})

export default WidgetShell

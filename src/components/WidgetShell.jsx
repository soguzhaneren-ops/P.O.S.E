import React from 'react'
import WidgetErrorBoundary from './WidgetErrorBoundary'

function WidgetShell({
  id,
  title,
  loading,
  isPreview,
  previewLabel,
  onDock,
  onFocus,
  onDoubleClickHeader,
  children,
  className = '',
  style,
  ...rest
}) {
  return (
    <div
      style={style}
      className={`bg-[#0c1821] rounded border border-[#1c3547] flex flex-col overflow-hidden ${className}`}
      {...rest}
    >
      {isPreview ? (
        previewLabel
      ) : (
        <>
          <div
            onDoubleClick={onDoubleClickHeader}
            className="drag-handle cursor-grab active:cursor-grabbing px-3 py-1.5 bg-[#132533] border-b border-[#1c3547] text-[9px] text-[#60809a] font-bold flex justify-between items-center select-none"
            title="DOUBLE-CLICK HEADER TO ENGAGE TARGET DIALOG FOCUS"
          >
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-amber-500 animate-pulse' : 'bg-[#00d2ff]'}`}></span>
              <span>{title}</span>
            </div>
            <div className="flex gap-1 text-[clamp(8px,2.2cqh,11px)]">
              <button
                onClick={(e) => { e.stopPropagation(); onDock() }}
                className="hover:text-amber-500 font-bold focus:outline-none cursor-pointer"
              >
                [ ⤳ DOCK ]
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onFocus() }}
                className="hover:text-cyan-400 font-bold focus:outline-none cursor-pointer"
                title="ENGAGE FOCUS MATRIX"
              >
                [ ⤖ FOCUS ]
              </button>
            </div>
          </div>
          <WidgetErrorBoundary widgetName={title}>
            {children}
          </WidgetErrorBoundary>
        </>
      )}
    </div>
  )
}

export default WidgetShell
import React from 'react'
import WidgetErrorBoundary from './WidgetErrorBoundary'

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
    children,
    className = '',
    style,
    ...rest
  },
  ref
) {
  return (
    <div
      ref={ref}
      style={style}
      className={`${bg} rounded border border-[#1c3547] flex flex-col overflow-hidden ${className}`}
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
            <span className={`w-1.5 h-1.5 rounded-full ${
                loading
                  ? 'bg-amber-500 animate-pulse'
                  : `${dotColor || 'bg-[#00d2ff]'} ${dotPulse ? 'animate-pulse' : ''}`
              }`}></span>              
              <span>{title}</span>
            </div>
            <div className="flex items-center gap-1 text-[clamp(8px,2.2cqh,11px)]">
              {headerActions && (
                <span onClick={(e) => e.stopPropagation()} className="flex items-center">
                  {headerActions}
                </span>
              )}
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
})

export default WidgetShell
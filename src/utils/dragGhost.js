// Native HTML5 drag-and-drop shows the browser's own screenshot-like ghost of the source
// element by default, which tends to render translucent/washed-out against this app's dark,
// semi-transparent panel backgrounds — that's most of why dragging has read as "weird" rather
// than like actually picking something up. This builds a solid, styled stand-in clone and
// swaps it in via setDragImage so what follows the cursor looks like a deliberately "lifted"
// card (opaque, glowing) instead of a pale rectangle.
//
// Two things this deliberately avoids, both of which produced a squished/garbled ghost when
// tried (this app runs inside a Tauri WKWebView, i.e. Safari's engine):
// - `transform: rotate(...)` on the ghost — WKWebView's setDragImage rasterizer snapshots the
//   element's unrotated axis-aligned box, so a rotated child paints outside it and gets
//   clipped/sheared.
// - Positioning the clone thousands of pixels off-screen (e.g. top:-9999px) before the
//   snapshot — WKWebView appears to skip fully painting content that far outside the
//   viewport, so the snapshot comes back corrupted. Placed at the source element's real
//   on-screen position instead; it's removed again before the next paint, so nothing visible
//   doubles up.
export function attachDragGhost(e, { background = '#0f1c27' } = {}) {
  const sourceEl = e.currentTarget
  const rect = sourceEl.getBoundingClientRect()
  const ghost = sourceEl.cloneNode(true)

  ghost.style.position = 'fixed'
  ghost.style.top = `${rect.top}px`
  ghost.style.left = `${rect.left}px`
  ghost.style.width = `${rect.width}px`
  ghost.style.height = `${rect.height}px`
  ghost.style.margin = '0'
  ghost.style.boxSizing = 'border-box'
  ghost.style.pointerEvents = 'none'
  ghost.style.backgroundColor = background
  ghost.style.borderRadius = getComputedStyle(sourceEl).borderRadius || '4px'
  ghost.style.boxShadow = '0 18px 34px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,210,255,0.35), 0 0 16px rgba(0,210,255,0.2)'
  ghost.style.opacity = '0.97'

  document.body.appendChild(ghost)
  const grabX = e.clientX - rect.left
  const grabY = e.clientY - rect.top
  e.dataTransfer.setDragImage(ghost, grabX, grabY)

  // setDragImage snapshots synchronously during dragstart handling, so the clone only needs
  // to survive to the end of this task — removed on the next tick rather than immediately.
  setTimeout(() => {
    if (ghost.parentNode) ghost.parentNode.removeChild(ghost)
  }, 0)
}

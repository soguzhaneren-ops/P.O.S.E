import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { attachDragGhost } from '../utils/dragGhost'

const TEXT_COLORS = [
  { key: 'cyan', label: 'CYAN', hex: '#22e3ff' },
  { key: 'amber', label: 'AMBER', hex: '#f2984a' },
  { key: 'emerald', label: 'EMERALD', hex: '#4ade80' },
  { key: 'red', label: 'RED', hex: '#ff1414' },
]

// `family` is the bare name used to detect what's under the caret (matched against
// getComputedStyle, which always reports the first family unquoted-and-lowercased).
// `stack` is what actually gets applied, with a generic fallback in case the webfont
// hasn't loaded yet. Times New Roman ships with the OS, so it needs no <link> import;
// the other three are loaded from Google Fonts in index.html.
const FONT_FAMILIES = [
  { key: 'orbitron', label: 'ORBITRON', family: 'Orbitron', stack: 'Orbitron, sans-serif' },
  { key: 'roboto-mono', label: 'ROBOTO MONO', family: 'Roboto Mono', stack: 'Roboto Mono, monospace' },
  { key: 'montserrat', label: 'MONTSERRAT', family: 'Montserrat', stack: 'Montserrat, sans-serif' },
  { key: 'times', label: 'TIMES NEW ROMAN', family: 'Times New Roman', stack: "Times New Roman, Times, serif" },
]

const DEFAULT_FONT_SIZE = 16
const DEFAULT_COLOR = TEXT_COLORS[0].hex
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 96
const FS_KEY = 'dashboardFileSystem'
// MainWidget is mounted as two separate component instances — one in the grid tile, one
// in the focal-zoom overlay — swapped in and out as focus mode toggles. Each instance has
// its own local React state, so without persisting "where you are" the same way `tree`
// already is, every toggle silently reset navigation back to the root. These two keys fix
// that: whichever instance mounts next reads the last-known location instead of starting fresh.
const FS_PATH_KEY = 'dashboardFSPath'
const FS_OPEN_FILE_KEY = 'dashboardFSOpenFile'

function rgbToHex(rgbStr) {
  const match = rgbStr && rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return null
  const toHex = (n) => Number(n).toString(16).padStart(2, '0')
  return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`
}

// WebKit's execCommand('foreColor', ...) under styleWithCSS bakes a literal caret-color
// declaration into the span it creates for a collapsed selection's "future typing" state
// — an internal implementation detail of how it previews the pending color, not something
// this code ever asks for. Left in the DOM, that stale value wins over the live caret-color
// bound on the editable root (a descendant's inline style always beats an ancestor's), which
// is exactly what made the caret show a color disconnected from anything actually being
// typed. Run after every edit so the root's reactive binding is always what's shown.
function stripStrayCaretColor(root) {
  root.querySelectorAll('[style*="caret-color"]').forEach(el => {
    el.style.removeProperty('caret-color')
    if (!el.getAttribute('style')) el.removeAttribute('style')
  })
}

// --- File-tree data model & pure helpers -----------------------------------------------
// Folder: { id, type: 'folder', name, children: Node[] }
// File:   { id, type: 'file', name, content } — content is contentEditable innerHTML, same
// format the old single-buffer editor already produced/consumed.

function findNode(root, id) {
  if (root.id === id) return root
  if (root.type !== 'folder') return null
  for (const child of root.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function updateNode(root, id, updater) {
  if (root.id === id) return updater(root)
  if (root.type !== 'folder') return root
  return { ...root, children: root.children.map(c => updateNode(c, id, updater)) }
}

function removeNode(root, id) {
  if (root.type !== 'folder') return root
  return { ...root, children: root.children.filter(c => c.id !== id).map(c => removeNode(c, id)) }
}

function insertNode(root, parentId, node) {
  if (root.id === parentId) {
    return root.type === 'folder' ? { ...root, children: [...root.children, node] } : root
  }
  if (root.type !== 'folder') return root
  return { ...root, children: root.children.map(c => insertNode(c, parentId, node)) }
}

function isDescendantOf(root, id, ancestorId) {
  const ancestor = findNode(root, ancestorId)
  if (!ancestor || ancestor.type !== 'folder') return false
  const stack = [...ancestor.children]
  while (stack.length) {
    const n = stack.pop()
    if (n.id === id) return true
    if (n.type === 'folder') stack.push(...n.children)
  }
  return false
}

// Rejects dropping a folder into itself/its own descendant (would orphan the subtree) and
// dropping anything onto a file (files can't hold children) by returning the tree unchanged.
function moveNode(root, nodeId, targetFolderId) {
  if (nodeId === targetFolderId) return root
  const target = findNode(root, targetFolderId)
  if (!target || target.type !== 'folder') return root
  if (isDescendantOf(root, targetFolderId, nodeId)) return root
  const node = findNode(root, nodeId)
  if (!node) return root
  return insertNode(removeNode(root, nodeId), targetFolderId, node)
}

// Walks currentPath (an array of folder ids, root..current) against the live tree so
// breadcrumb labels stay correct after a rename, and so a deleted ancestor can be detected.
function resolveBreadcrumb(root, pathIds) {
  const nodes = [root]
  let cursor = root
  for (let i = 1; i < pathIds.length; i++) {
    const next = cursor.children?.find(c => c.id === pathIds[i])
    if (!next) break
    nodes.push(next)
    cursor = next
  }
  return nodes
}

function buildInitialTree() {
  const saved = localStorage.getItem(FS_KEY)
  if (saved) {
    try {
      return JSON.parse(saved)
    } catch {
      // Fall through to a fresh tree if the stored JSON is somehow corrupt.
    }
  }
  // First run of the file-browser version — migrate whatever the old single-buffer
  // editor had (same dashboardMainRichText -> dashboardTempText fallback chain it always
  // used) into one file, so existing writing is preserved rather than discarded.
  const children = []
  const legacyHtml = localStorage.getItem('dashboardMainRichText')
  const legacyPlain = localStorage.getItem('dashboardTempText')
  if (legacyHtml !== null) {
    children.push({ id: crypto.randomUUID(), type: 'file', name: 'LEGACY_BUFFER', content: legacyHtml })
  } else if (legacyPlain) {
    const span = document.createElement('span')
    span.style.fontSize = `${DEFAULT_FONT_SIZE}px`
    span.style.color = DEFAULT_COLOR
    span.textContent = legacyPlain
    children.push({ id: crypto.randomUUID(), type: 'file', name: 'LEGACY_BUFFER', content: span.outerHTML })
  }
  return { id: 'root', type: 'folder', name: 'ROOT', children }
}

// Re-resolves the saved path against the tree it'll actually be paired with, so a folder
// deleted from another session/instance doesn't leave a dangling path — resolveBreadcrumb
// already walks defensively and stops at the deepest id that still exists.
function buildInitialPath(tree) {
  const saved = localStorage.getItem(FS_PATH_KEY)
  if (!saved) return ['root']
  try {
    const parsed = JSON.parse(saved)
    return resolveBreadcrumb(tree, parsed).map(n => n.id)
  } catch {
    return ['root']
  }
}

function buildInitialOpenFile(tree) {
  const saved = localStorage.getItem(FS_OPEN_FILE_KEY)
  if (!saved) return null
  const node = findNode(tree, saved)
  return node && node.type === 'file' ? saved : null
}

// First hand-drawn icons in this app (no icon library or SVG convention exists elsewhere) —
// thin-stroke line art using currentColor so callers drive color/size via className.
function FolderIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6.5C3 5.67 3.67 5 4.5 5H9.5L11.5 7H19.5C20.33 7 21 7.67 21 8.5V17.5C21 18.33 20.33 19 19.5 19H4.5C3.67 19 3 18.33 3 17.5V6.5Z" />
    </svg>
  )
}

function FileIcon({ className = '' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 3.5C6 3.22 6.22 3 6.5 3H13.5L18 7.5V20.5C18 20.78 17.78 21 17.5 21H6.5C6.22 21 6 20.78 6 20.5V3.5Z" />
      <path d="M13.5 3V7.5H18" />
      <path d="M8.5 12H15.5M8.5 15H15.5M8.5 18H12.5" />
    </svg>
  )
}

function MainWidget() {
  const editableRef = useRef(null)
  const colorMenuRef = useRef(null)
  // The editable box loses the browser's selection the instant a toolbar control takes
  // focus (e.g. typing in the size box). Plain .focus() afterward does not reliably put
  // the caret back where it was, so the last real selection inside the box is cloned
  // here and explicitly reapplied whenever a toolbar action needs to act on "wherever
  // the user was."
  const savedRangeRef = useRef(null)
  const lastAppliedSizeRef = useRef(DEFAULT_FONT_SIZE)
  const fontMenuRef = useRef(null)
  const createMenuRef = useRef(null)
  const contextMenuRef = useRef(null)
  const hoverTimerRef = useRef(null)
  // Set right before an Escape-triggered blur so the blur handler below knows to discard
  // rather than commit — without this, clicking away to exit rename mode had no effect
  // (only Enter/Escape did anything), which didn't match how renaming works anywhere else
  // on a desktop; blurring now always exits, same as the font-size input already does.
  const cancelRenameRef = useRef(false)
  // While true, selectionchange events are known to be trailing side effects of our own
  // execCommand calls rather than genuine user action — the toolbar's displayed size/color
  // must ignore them, or the number we just applied gets clobbered back to the old value
  // a moment later. savedRangeRef itself is NOT gated by this — it keeps tracking the
  // live selection throughout, which is what lets +/- keep working on the same highlight
  // without the user having to reselect it between clicks.
  const isApplyingRef = useRef(false)

  const [tree, setTree] = useState(buildInitialTree)
  const [currentPath, setCurrentPath] = useState(() => buildInitialPath(tree))
  const [openFileId, setOpenFileId] = useState(() => buildInitialOpenFile(tree))
  // Plain array rather than a Set: it only ever needs `.includes`/spread over a handful of
  // visible tiles, and stays trivially JSON-serializable if this ever needs persisting too.
  const [selectedIds, setSelectedIds] = useState([])
  const selectionAnchorRef = useRef(null)
  const [draggedIds, setDraggedIds] = useState([])
  const [dragOverFolderId, setDragOverFolderId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingValue, setEditingValue] = useState('')
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false)
  const [contextMenu, setContextMenu] = useState(null)
  const [hoverPreview, setHoverPreview] = useState(null)

  const [charCount, setCharCount] = useState(0)
  const [fontSizeInput, setFontSizeInput] = useState(DEFAULT_FONT_SIZE)
  const [activeColorHex, setActiveColorHex] = useState(DEFAULT_COLOR)
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false)
  const [activeFontFamily, setActiveFontFamily] = useState(null)
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(FS_KEY, JSON.stringify(tree))
  }, [tree])

  // Kept in sync with localStorage so the *other* MainWidget instance (grid tile vs.
  // focal-zoom overlay — see FS_PATH_KEY/FS_OPEN_FILE_KEY above) picks up where this one
  // left off the next time it mounts, instead of resetting to the root on every focus toggle.
  useEffect(() => {
    localStorage.setItem(FS_PATH_KEY, JSON.stringify(currentPath))
  }, [currentPath])

  useEffect(() => {
    if (openFileId) localStorage.setItem(FS_OPEN_FILE_KEY, openFileId)
    else localStorage.removeItem(FS_OPEN_FILE_KEY)
  }, [openFileId])

  useEffect(() => () => clearTimeout(hoverTimerRef.current), [])

  // Loads a file's content into the editable box when it's opened. Deliberately keyed only
  // on openFileId, not tree — depending on tree would re-fire (and clobber the live caret)
  // on every keystroke, since persist() below writes back into the same tree.
  useEffect(() => {
    if (!openFileId) return
    const node = findNode(tree, openFileId)
    const editable = editableRef.current
    if (!editable || !node) return
    editable.innerHTML = node.content || ''
    stripStrayCaretColor(editable)
    setCharCount(editable.textContent.length)
    setFontSizeInput(DEFAULT_FONT_SIZE)
    setActiveColorHex(DEFAULT_COLOR)
    setActiveFontFamily(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load only on file switch, not on every tree write
  }, [openFileId])

  // Converts any legacy <font size="7"> markers (the only way to get execCommand's
  // arbitrary-size "future typing" behavior) into real <span style="font-size:...">,
  // preserving the full selection through the swap — not just the caret — so that
  // highlighting text and hitting +/- repeatedly keeps working on that same highlight
  // instead of collapsing it to a point after the first click. appendChild moves text
  // nodes rather than cloning them, so the original start/end container references stay
  // valid after the font tag is replaced; only their offsets need to be reapplied.
  const convertLegacyFontTags = useCallback(() => {
    const editable = editableRef.current
    if (!editable) return
    const fonts = editable.querySelectorAll('font[size="7"]')
    if (fonts.length === 0) return

    const sel = window.getSelection()
    let savedBounds = null
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      if (editable.contains(range.commonAncestorContainer)) {
        savedBounds = {
          startContainer: range.startContainer,
          startOffset: range.startOffset,
          endContainer: range.endContainer,
          endOffset: range.endOffset,
        }
      }
    }

    fonts.forEach(font => {
      const span = document.createElement('span')
      span.style.fontSize = `${lastAppliedSizeRef.current}px`
      while (font.firstChild) span.appendChild(font.firstChild)
      font.replaceWith(span)
    })

    if (savedBounds) {
      try {
        const newRange = document.createRange()
        newRange.setStart(savedBounds.startContainer, savedBounds.startOffset)
        newRange.setEnd(savedBounds.endContainer, savedBounds.endOffset)
        sel.removeAllRanges()
        sel.addRange(newRange)
      } catch {
        // A container that no longer exists in the tree — leave the selection as is
        // rather than throw; worst case the highlight doesn't survive this one swap.
      }
    }
  }, [])

  const persist = useCallback(() => {
    const editable = editableRef.current
    if (!editable || !openFileId) return
    convertLegacyFontTags()
    stripStrayCaretColor(editable)
    const html = editable.innerHTML
    setTree(prev => updateNode(prev, openFileId, n => ({ ...n, content: html })))
    setCharCount(editable.textContent.length)
  }, [convertLegacyFontTags, openFileId])

  // Reflects the toolbar to whatever's actually at the caret/selection, like any real
  // text editor — so it always shows the size/color of what you're about to type or
  // what you've just clicked into, not a single global value for the whole box. Also
  // where the current selection gets saved for the toolbar to restore later.
  //
  // Only runs while the editable box itself has focus — once focus moves to the size
  // input (to type a number directly), the browser's own selection state around that
  // shift is not something we want overwriting savedRangeRef; the last good range from
  // right before the shift is exactly what a highlighted selection needs preserved.
  const updateToolbarFromSelection = useCallback(() => {
    const editable = editableRef.current
    if (!editable) return
    if (document.activeElement !== editable) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (!editable.contains(range.commonAncestorContainer)) return

    // Always kept current, even while isApplyingRef suppresses the display below —
    // otherwise a second +/- click would restore a stale pre-apply range instead of
    // the highlight's settled post-apply position, undoing the point of preserving it.
    savedRangeRef.current = range.cloneRange()

    if (isApplyingRef.current) return

    let node = sel.anchorNode
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement
    if (!node) return
    const computed = getComputedStyle(node)
    const size = parseFloat(computed.fontSize)
    if (!isNaN(size)) setFontSizeInput(Math.round(size))
    const hex = rgbToHex(computed.color)
    if (hex) setActiveColorHex(hex)

    const firstFamily = computed.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase()
    const familyMatch = FONT_FAMILIES.find(f => f.family.toLowerCase() === firstFamily)
    setActiveFontFamily(familyMatch ? familyMatch.key : null)
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', updateToolbarFromSelection)
    return () => document.removeEventListener('selectionchange', updateToolbarFromSelection)
  }, [updateToolbarFromSelection])

  useEffect(() => {
    if (!isColorMenuOpen) return
    const handleClickOutside = (e) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target)) {
        setIsColorMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isColorMenuOpen])

  useEffect(() => {
    if (!isFontMenuOpen) return
    const handleClickOutside = (e) => {
      if (fontMenuRef.current && !fontMenuRef.current.contains(e.target)) {
        setIsFontMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isFontMenuOpen])

  useEffect(() => {
    if (!isCreateMenuOpen) return
    const handleClickOutside = (e) => {
      if (createMenuRef.current && !createMenuRef.current.contains(e.target)) {
        setIsCreateMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isCreateMenuOpen])

  useEffect(() => {
    if (!contextMenu) return
    const handleClickOutside = (e) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  // Focuses the editable box and puts the last known selection back exactly where it
  // was, so a toolbar action always applies to "wherever the user was" rather than
  // wherever the browser's default post-focus caret happens to land (usually the start).
  const restoreSelection = () => {
    const editable = editableRef.current
    if (!editable) return
    editable.focus()
    const sel = window.getSelection()
    if (savedRangeRef.current) {
      sel.removeAllRanges()
      sel.addRange(savedRangeRef.current)
    }
  }

  // Wraps a formatting operation so the selectionchange events it triggers (from
  // restoreSelection's addRange, from execCommand's own DOM changes, from
  // convertLegacyFontTags' range swap) can't clobber the toolbar display with a stale
  // reading taken mid-operation. 80ms is comfortably past when trailing events from our
  // own synchronous DOM work actually fire, while still being well under normal human
  // reaction time for the next real interaction.
  const withSuppressedToolbarSync = (fn) => {
    isApplyingRef.current = true
    fn()
    setTimeout(() => {
      isApplyingRef.current = false
    }, 80)
  }

  // Applies to the current selection if there is one, otherwise to whatever gets typed
  // next — same as font size/color pickers in any normal text editor. Legacy execCommand
  // is still the only way to get that "future typing state" behavior without a full
  // editor library, so it wraps the range in a legacy <font size="7"> marker and we swap
  // that for a real <span style="font-size:...">.
  const applyFontSize = (sizePx) => {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(sizePx) || DEFAULT_FONT_SIZE))
    const editable = editableRef.current
    if (!editable) return
    const run = () => withSuppressedToolbarSync(() => {
      restoreSelection()
      lastAppliedSizeRef.current = clamped
      document.execCommand('styleWithCSS', false, false)
      document.execCommand('fontSize', false, '7')
      convertLegacyFontTags()
      setFontSizeInput(clamped)
      persist()
    })
    // Deferred a tick when focus isn't already on the editable: applying this
    // synchronously from within the size input's own blur handler doesn't reliably
    // hand focus back in every browser — by the time this runs, the blur has settled.
    if (document.activeElement !== editable) {
      setTimeout(run, 0)
    } else {
      run()
    }
  }

  const applyColor = (hex) => {
    const editable = editableRef.current
    if (!editable) return
    withSuppressedToolbarSync(() => {
      restoreSelection()
      document.execCommand('styleWithCSS', false, true)
      document.execCommand('foreColor', false, hex)
      setActiveColorHex(hex)
      setIsColorMenuOpen(false)
      persist()
    })
  }

  // Same execCommand pattern as applyColor above — unlike font size, execCommand's
  // fontName argument accepts an arbitrary family name directly (no legacy magic-number
  // tag needed), so styleWithCSS produces a real inline-styled span in one step and gets
  // the same highlight-preserving, future-typing-state behavior color already has.
  const applyFontFamily = (fontOption) => {
    const editable = editableRef.current
    if (!editable) return
    withSuppressedToolbarSync(() => {
      restoreSelection()
      document.execCommand('styleWithCSS', false, true)
      document.execCommand('fontName', false, fontOption.stack)
      setActiveFontFamily(fontOption.key)
      setIsFontMenuOpen(false)
      persist()
    })
  }

  // --- File-browser handlers ------------------------------------------------------------

  const startRename = (id, name) => {
    setEditingId(id)
    setEditingValue(name)
  }

  const saveRename = (id) => {
    const clean = editingValue.trim()
    if (!clean) {
      setEditingId(null)
      return
    }
    setTree(prev => updateNode(prev, id, n => ({ ...n, name: clean })))
    setEditingId(null)
  }

  const createNode = (type) => {
    const id = crypto.randomUUID()
    const node = type === 'folder'
      ? { id, type: 'folder', name: 'NEW_FOLDER', children: [] }
      : { id, type: 'file', name: 'NEW_FILE', content: '' }
    setTree(prev => insertNode(prev, currentFolder.id, node))
    setIsCreateMenuOpen(false)
    startRename(id, node.name)
  }

  const handleDeleteNodes = (ids) => {
    setTree(prev => ids.reduce((acc, id) => removeNode(acc, id), prev))
    setSelectedIds(prev => prev.filter(id => !ids.includes(id)))
  }

  // Pulls nodes out of whichever folder they're currently sitting in, up into that folder's
  // parent — the fastest way to "take this out of the folder" without needing precise
  // drag-and-drop onto a breadcrumb crumb.
  const handleMoveUpNodes = (ids, parentId) => {
    setTree(prev => ids.reduce((acc, id) => moveNode(acc, id, parentId), prev))
  }

  // Click-to-select mirroring desktop file managers: a plain click replaces the selection,
  // Cmd/Ctrl+click toggles one item in or out of it, Shift+click extends it as a contiguous
  // range from the last anchor (using the folder's own child order, same as render order).
  const handleTileClick = (e, node) => {
    e.stopPropagation()
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds(prev => (prev.includes(node.id) ? prev.filter(id => id !== node.id) : [...prev, node.id]))
      selectionAnchorRef.current = node.id
      return
    }
    if (e.shiftKey && selectionAnchorRef.current) {
      const ids = currentFolder.children.map(c => c.id)
      const anchorIdx = ids.indexOf(selectionAnchorRef.current)
      const targetIdx = ids.indexOf(node.id)
      if (anchorIdx === -1 || targetIdx === -1) {
        setSelectedIds([node.id])
      } else {
        const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
        setSelectedIds(ids.slice(start, end + 1))
      }
      return
    }
    setSelectedIds([node.id])
    selectionAnchorRef.current = node.id
  }

  const scheduleHoverPreview = (e, node) => {
    if (node.type !== 'folder') return
    const rect = e.currentTarget.getBoundingClientRect()
    clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setHoverPreview({ id: node.id, x: rect.left, y: rect.bottom + 6 })
    }, 900)
  }

  const cancelHoverPreview = (node) => {
    clearTimeout(hoverTimerRef.current)
    setHoverPreview(prev => (prev?.id === node.id ? null : prev))
  }

  // Dragging a tile that's part of the current multi-selection carries the whole selection
  // along; dragging one that isn't first collapses the selection down to just that tile —
  // same "drag an unselected item" convention desktop file managers use.
  const handleDragStart = (e, id) => {
    e.stopPropagation()
    const carryingSelection = selectedIds.includes(id) && selectedIds.length > 1
    const ids = carryingSelection ? selectedIds : [id]
    if (!carryingSelection) {
      setSelectedIds([id])
      selectionAnchorRef.current = id
    }
    setDraggedIds(ids)
    e.dataTransfer.effectAllowed = 'move'
    attachDragGhost(e, { background: '#132533' })
  }

  const handleDragOverIcon = (e, node) => {
    e.preventDefault()
    e.stopPropagation()
    if (node.type === 'folder' && draggedIds.length > 0 && !draggedIds.includes(node.id)) setDragOverFolderId(node.id)
  }

  const handleDragLeaveIcon = (node) => {
    setDragOverFolderId(prev => (prev === node.id ? null : prev))
  }

  const handleDropOnIcon = (e, node) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolderId(null)
    if (draggedIds.length > 0 && node.type === 'folder') {
      setTree(prev => draggedIds.reduce((acc, id) => moveNode(acc, id, node.id), prev))
    }
    setDraggedIds([])
  }

  const handleDragEnd = () => {
    setDraggedIds([])
    setDragOverFolderId(null)
  }

  const handleDropOnCrumb = (e, crumbId, isTrailing) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isTrailing && draggedIds.length > 0) {
      setTree(prev => draggedIds.reduce((acc, id) => moveNode(acc, id, crumbId), prev))
    }
    setDraggedIds([])
  }

  const breadcrumbNodes = resolveBreadcrumb(tree, currentPath)
  const currentFolder = breadcrumbNodes[breadcrumbNodes.length - 1]
  const parentFolder = breadcrumbNodes.length > 1 ? breadcrumbNodes[breadcrumbNodes.length - 2] : null
  const openNode = openFileId ? findNode(tree, openFileId) : null

  return (
    <div
      className="p-4 flex-grow flex flex-col justify-between overflow-hidden font-sans"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => e.preventDefault()}
    >
      {/* HUD panel utility styles for the file-browser's floating menus (create menu,
          right-click menu, folder hover-preview) — cut corners, a soft idle glow pulse,
          a quick materialize-in on open, and a "sweep" hover cue on menu rows. Kept
          scoped to this widget as a first pass; worth promoting app-wide if it lands well. */}
      <style>{`
        /* Deliberately animates transform only, never opacity — the panel must be fully
           visible immediately even if this animation never plays (throttled by a
           backgrounded window, prefers-reduced-motion, etc.); the motion is a flourish
           layered on top of an already-usable menu, not a gate on seeing it at all. */
        @keyframes hudPanelIn {
          0% { transform: scale(0.92) translateY(-6px); }
          100% { transform: scale(1) translateY(0); }
        }
        @keyframes hudGlowPulse {
          0%, 100% { box-shadow: 0 0 10px rgba(0,210,255,0.18), inset 0 0 20px rgba(0,210,255,0.02); }
          50% { box-shadow: 0 0 18px rgba(0,210,255,0.38), inset 0 0 20px rgba(0,210,255,0.05); }
        }
        @keyframes hudFabPing {
          0% { transform: scale(1); opacity: 0.55; }
          100% { transform: scale(1.55); opacity: 0; }
        }
        .hud-panel {
          clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
          animation: hudPanelIn 140ms cubic-bezier(0.16, 1, 0.3, 1) forwards, hudGlowPulse 2.6s ease-in-out 140ms infinite;
          transform-origin: top left;
        }
        .hud-panel-up {
          transform-origin: bottom right;
        }
        .hud-menu-item {
          border-left: 2px solid transparent;
          transition: all 150ms ease;
        }
        .hud-menu-item:hover {
          border-left-color: rgba(0, 210, 255, 0.6);
          padding-left: 14px;
        }
        .hud-fab-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          border: 1px solid rgba(0, 210, 255, 0.45);
          animation: hudFabPing 2.1s cubic-bezier(0, 0, 0.2, 1) infinite;
          pointer-events: none;
        }
      `}</style>

      <div className="flex flex-col gap-2 flex-grow my-2 overflow-hidden">
        {openFileId ? (
          // Keyed distinctly from the browser view below so React always fully unmounts
          // this subtree on switch, rather than attempting to diff/reuse DOM nodes across
          // it — the contentEditable's innerHTML is mutated directly outside React's own
          // bookkeeping (see the openFileId load effect), which otherwise left stale
          // editor content visually bleeding through after clicking back.
          <Fragment key={`editor-${openFileId}`}>
            <div className="flex items-center justify-between select-none border-b border-[#1c3547]/30 pb-2 gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setOpenFileId(null)}
                  className="group flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded border border-[#1c3547] hover:border-cyan-500/50 text-[11px] font-bold tracking-wide text-[#60809a] hover:text-cyan-400 hover:bg-[#132533]/60 transition-all cursor-pointer shrink-0"
                >
                  <span className="text-sm leading-none group-hover:-translate-x-0.5 transition-transform">←</span>
                  BACK_TO_FILES
                </button>
                <span className="text-xs text-[#60809a] font-bold tracking-widest truncate">
                  // {openNode?.name || 'FILE'}
                </span>
              </div>
              <span className="text-xs text-[#60809a] font-bold tracking-widest shrink-0">CHARS: {charCount}</span>
            </div>

            {/* Compact style dock — applies to the current selection, or to text typed next.
                Every control here uses onMouseDown+preventDefault so clicking it never steals
                focus/selection away from the editable box below — without that, the browser's
                default "click moves focus" behavior would collapse whatever was selected right
                before the format could be applied to it. */}
            <div className="flex items-center gap-2 select-none shrink-0">
              <div className="flex items-center border border-[#1c3547] rounded overflow-hidden text-xs font-bold">
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFontSize(fontSizeInput - 1)}
                  className="px-2 py-1 text-[#60809a] hover:text-cyan-400 hover:bg-[#132533] transition-colors cursor-pointer"
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={fontSizeInput}
                  onChange={(e) => {
                    const digitsOnly = e.target.value.replace(/[^0-9]/g, '')
                    setFontSizeInput(digitsOnly === '' ? '' : Number(digitsOnly))
                  }}
                  onBlur={(e) => applyFontSize(Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.target.blur()
                  }}
                  className="w-10 text-center bg-[#090e14] text-cyan-100 border-x border-[#1c3547] py-1 focus:outline-none"
                />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFontSize(fontSizeInput + 1)}
                  className="px-2 py-1 text-[#60809a] hover:text-cyan-400 hover:bg-[#132533] transition-colors cursor-pointer"
                >
                  +
                </button>
              </div>

              <div className="relative" ref={colorMenuRef}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setIsColorMenuOpen(v => !v); setIsFontMenuOpen(false) }}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[#1c3547] text-[10px] font-bold text-[#60809a] hover:text-cyan-400 transition-colors cursor-pointer"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-white/30"
                    style={{ backgroundColor: activeColorHex }}
                  />
                  <span className="text-[8px]">▾</span>
                </button>
                {isColorMenuOpen && (
                  <div className="absolute top-full mt-1 left-0 z-20 bg-slate-950/95 border border-cyan-500/20 backdrop-blur-md rounded p-1.5 flex flex-col gap-1 w-28">
                    {TEXT_COLORS.map(c => (
                      <button
                        key={c.key}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyColor(c.hex)}
                        className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                          activeColorHex.toLowerCase() === c.hex.toLowerCase()
                            ? 'bg-[#132533] text-cyan-200'
                            : 'text-[#60809a] hover:text-cyan-400 hover:bg-[#132533]/50'
                        }`}
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.hex }} />
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative" ref={fontMenuRef}>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setIsFontMenuOpen(v => !v); setIsColorMenuOpen(false) }}
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-[#1c3547] text-[10px] font-bold text-[#60809a] hover:text-cyan-400 transition-colors cursor-pointer"
                >
                  <span
                    className="text-[11px] leading-none"
                    style={{ fontFamily: FONT_FAMILIES.find(f => f.key === activeFontFamily)?.stack }}
                  >
                    Aa
                  </span>
                  <span className="text-[8px]">▾</span>
                </button>
                {isFontMenuOpen && (
                  <div className="absolute top-full mt-1 left-0 z-20 bg-slate-950/95 border border-cyan-500/20 backdrop-blur-md rounded p-1.5 flex flex-col gap-1 w-40">
                    {FONT_FAMILIES.map(f => (
                      <button
                        key={f.key}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyFontFamily(f)}
                        style={{ fontFamily: f.stack }}
                        className={`px-2 py-1 rounded text-[10px] font-bold text-left transition-colors cursor-pointer ${
                          activeFontFamily === f.key
                            ? 'bg-[#132533] text-cyan-200'
                            : 'text-[#60809a] hover:text-cyan-400 hover:bg-[#132533]/50'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="relative w-full h-full overflow-hidden">
              {charCount === 0 && (
                <div
                  className="absolute inset-0 p-3 text-[#3a5266] pointer-events-none select-none font-bold leading-relaxed"
                  style={{ fontSize: `${DEFAULT_FONT_SIZE}px` }}
                >
                  AWAITING INPUT_ ENTER SYSTEM LOGS OR SECURE NOTES HERE...
                </div>
              )}
              <div
                ref={editableRef}
                contentEditable
                suppressContentEditableWarning
                onInput={persist}
                className="w-full h-full bg-[#090e14]/50 border border-[#1c3547] p-3 rounded font-bold focus:outline-none focus:border-[#00d2ff] focus:shadow-[0_0_10px_rgba(0,210,255,0.08)] overflow-auto leading-relaxed transition-colors duration-300 font-sans"
                style={{ fontSize: `${DEFAULT_FONT_SIZE}px`, color: DEFAULT_COLOR, caretColor: activeColorHex }}
              />
            </div>
          </Fragment>
        ) : (
          <Fragment key="browser">
            <div className="text-xs text-[#60809a] font-bold tracking-widest flex justify-between select-none border-b border-[#1c3547]/30 pb-2">
              <span>FILE_SYSTEM // MAIN_UNIT</span>
              <span>ITEMS: {currentFolder.children.length}</span>
            </div>

            <div className="flex items-center gap-1 text-[10px] font-bold text-[#60809a] select-none flex-wrap shrink-0">
              {breadcrumbNodes.map((node, i) => {
                const isTrailing = i === breadcrumbNodes.length - 1
                return (
                  <span key={node.id} className="flex items-center gap-1">
                    {i > 0 && <span className="text-[#1c3547]">/</span>}
                    <button
                      onClick={() => setCurrentPath(currentPath.slice(0, i + 1))}
                      onDragOver={(e) => { if (!isTrailing) { e.preventDefault(); e.stopPropagation() } }}
                      onDrop={(e) => handleDropOnCrumb(e, node.id, isTrailing)}
                      className={`transition-colors cursor-pointer ${isTrailing ? 'text-cyan-300' : 'hover:text-cyan-400'}`}
                    >
                      {node.id === 'root' ? 'HOME' : node.name}
                    </button>
                  </span>
                )
              })}
            </div>

            <div className="relative flex-grow overflow-hidden">
              <div
                className="flex flex-wrap content-start gap-3 overflow-auto h-full p-1"
                onClick={() => setSelectedIds([])}
              >
                {currentFolder.children.length === 0 && (
                  <div className="w-full h-full flex items-center justify-center text-[#3a5266] text-xs font-bold select-none">
                    EMPTY_DIRECTORY // USE [+] TO CREATE
                  </div>
                )}
                {currentFolder.children.map(node => (
                  <div
                    key={node.id}
                    draggable={editingId !== node.id}
                    style={{ WebkitUserDrag: 'element' }}
                    unselectable="on"
                    onDragStart={(e) => handleDragStart(e, node.id)}
                    onDragOver={(e) => handleDragOverIcon(e, node)}
                    onDragLeave={() => handleDragLeaveIcon(node)}
                    onDrop={(e) => handleDropOnIcon(e, node)}
                    onDragEnd={handleDragEnd}
                    onMouseEnter={(e) => scheduleHoverPreview(e, node)}
                    onMouseLeave={() => cancelHoverPreview(node)}
                    onMouseDown={() => cancelHoverPreview(node)}
                    onClick={(e) => handleTileClick(e, node)}
                    onDoubleClick={() => {
                      if (editingId === node.id) return
                      cancelHoverPreview(node)
                      if (node.type === 'folder') setCurrentPath([...breadcrumbNodes.map(n => n.id), node.id])
                      else setOpenFileId(node.id)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      cancelHoverPreview(node)
                      const carryingSelection = selectedIds.includes(node.id) && selectedIds.length > 1
                      const ids = carryingSelection ? selectedIds : [node.id]
                      if (!carryingSelection) {
                        setSelectedIds(ids)
                        selectionAnchorRef.current = node.id
                      }
                      setContextMenu({ ids, x: e.clientX, y: e.clientY, confirmingDelete: false })
                    }}
                    className={`flex flex-col items-center gap-1.5 w-24 p-2.5 rounded cursor-pointer active:cursor-grabbing select-none transition-[opacity,transform,background-color,box-shadow] duration-150 ${
                      draggedIds.includes(node.id) ? 'opacity-30 scale-90' : ''
                    } ${
                      dragOverFolderId === node.id ? 'bg-cyan-500/10 ring-1 ring-cyan-400 scale-105 shadow-[0_0_14px_rgba(0,210,255,0.3)]' : ''
                    } ${
                      selectedIds.includes(node.id) ? 'bg-[#132533] ring-1 ring-cyan-500/40' : 'hover:bg-[#132533]/50'
                    }`}
                  >
                    {node.type === 'folder' ? (
                      <FolderIcon className="w-12 h-12 text-amber-500 shrink-0" />
                    ) : (
                      <FileIcon className="w-12 h-12 text-cyan-400 shrink-0" />
                    )}
                    {editingId === node.id ? (
                      <input
                        type="text"
                        value={editingValue}
                        autoFocus
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.target.blur()
                          if (e.key === 'Escape') {
                            cancelRenameRef.current = true
                            e.target.blur()
                          }
                        }}
                        onBlur={() => {
                          if (cancelRenameRef.current) {
                            cancelRenameRef.current = false
                            setEditingId(null)
                            return
                          }
                          saveRename(node.id)
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-[#090e14] border border-[#00d2ff] text-cyan-100 text-[10px] tracking-wide text-center px-1 py-0.5 rounded focus:outline-none font-sans"
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => { e.stopPropagation(); startRename(node.id, node.name) }}
                        className="text-[10px] font-bold tracking-wide text-cyan-100 text-center leading-tight line-clamp-2 break-words w-full"
                        title={node.name}
                      >
                        {node.name}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {hoverPreview && (() => {
                const previewNode = findNode(tree, hoverPreview.id)
                if (!previewNode || previewNode.type !== 'folder') return null
                const shown = previewNode.children.slice(0, 4)
                const extra = previewNode.children.length - shown.length
                // Portaled to <body> for the same reason the context menu is below — this
                // widget can be rendered inside the focal-zoom overlay, whose backdrop-blur
                // creates a new containing block for position:fixed, which would otherwise
                // throw off the viewport coordinates this is anchored with.
                return createPortal(
                  <div
                    style={{ position: 'fixed', top: hoverPreview.y, left: hoverPreview.x }}
                    className="hud-panel z-[60] bg-slate-950/95 border border-cyan-500/30 backdrop-blur-md p-2.5 w-48 pointer-events-none"
                  >
                    <div className="text-[9px] font-bold tracking-widest text-[#3d5b73] mb-1.5 truncate">
                      // {previewNode.name}
                    </div>
                    {previewNode.children.length === 0 ? (
                      <div className="text-[10px] font-bold text-[#3a5266] italic">EMPTY_DIRECTORY</div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {shown.map(c => (
                          <div key={c.id} className="flex items-center gap-1.5 text-[10px] font-bold text-cyan-100/90">
                            {c.type === 'folder' ? (
                              <FolderIcon className="w-3 h-3 text-amber-500 shrink-0" />
                            ) : (
                              <FileIcon className="w-3 h-3 text-cyan-400 shrink-0" />
                            )}
                            <span className="truncate">{c.name}</span>
                          </div>
                        ))}
                        {extra > 0 && (
                          <div className="text-[9px] font-bold text-[#60809a] tracking-wide pl-[18px]">+{extra} MORE</div>
                        )}
                      </div>
                    )}
                  </div>,
                  document.body
                )
              })()}

              <div className="absolute bottom-3 right-3 z-20" ref={createMenuRef}>
                <button
                  onClick={() => setIsCreateMenuOpen(v => !v)}
                  className="relative w-12 h-12 rounded-full bg-[#132533] hover:bg-[#1c3547] active:bg-[#00d2ff] active:text-black border border-cyan-500/40 text-cyan-400 flex items-center justify-center shadow-[0_0_15px_rgba(0,210,255,0.15)] transition-all cursor-pointer focus:outline-none"
                >
                  {!isCreateMenuOpen && <span className="hud-fab-ring" />}
                  <span className={`text-2xl font-bold leading-none transition-transform duration-200 ${isCreateMenuOpen ? 'rotate-45' : 'rotate-0'}`}>
                    +
                  </span>
                </button>
                {isCreateMenuOpen && (
                  <div className="hud-panel hud-panel-up absolute bottom-full mb-2 right-0 bg-slate-950/95 border border-cyan-500/30 backdrop-blur-md p-2 flex flex-col gap-1 w-44 z-20">
                    <div className="text-[9px] font-bold tracking-widest text-[#3d5b73] px-2.5 pb-1">// CREATE_NODE</div>
                    <button
                      onClick={() => createNode('folder')}
                      className="hud-menu-item px-2.5 py-1.5 text-xs font-bold tracking-wide text-left text-[#60809a] hover:text-cyan-400 hover:bg-[#132533]/50 cursor-pointer"
                    >
                      NEW FOLDER
                    </button>
                    <button
                      onClick={() => createNode('file')}
                      className="hud-menu-item px-2.5 py-1.5 text-xs font-bold tracking-wide text-left text-[#60809a] hover:text-cyan-400 hover:bg-[#132533]/50 cursor-pointer"
                    >
                      NEW TEXT FILE
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Fragment>
        )}
      </div>

      {contextMenu && createPortal(
        // Portaled to <body> and positioned in true viewport coordinates — rendered inline,
        // this would sit inside the focal-zoom overlay's backdrop-blur ancestor whenever the
        // widget is focused/zoomed, and backdrop-filter (like transform) creates a new
        // containing block for position:fixed, which silently offsets clientX/clientY from
        // where the menu actually lands. That's exactly what made this menu appear far from
        // the item that was right-clicked. Also clamped so it never renders off-screen.
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: Math.min(contextMenu.y, window.innerHeight - 160),
            left: Math.min(contextMenu.x, window.innerWidth - 190),
          }}
          className="hud-panel z-[60] bg-slate-950/95 border border-cyan-500/30 backdrop-blur-md p-2 flex flex-col gap-1 w-44"
        >
          <div className="text-[9px] font-bold tracking-widest text-[#3d5b73] px-2.5 pb-1">
            // NODE_ACTIONS{contextMenu.ids.length > 1 ? ` (${contextMenu.ids.length})` : ''}
          </div>
          {parentFolder && (
            <button
              onClick={() => {
                handleMoveUpNodes(contextMenu.ids, parentFolder.id)
                setContextMenu(null)
              }}
              className="hud-menu-item px-2.5 py-1.5 text-xs font-bold tracking-wide text-left text-[#60809a] hover:text-cyan-400 hover:bg-[#132533]/50 cursor-pointer"
            >
              MOVE UP
            </button>
          )}
          {contextMenu.ids.length === 1 && (
            <button
              onClick={() => {
                const n = findNode(tree, contextMenu.ids[0])
                startRename(contextMenu.ids[0], n?.name || '')
                setContextMenu(null)
              }}
              className="hud-menu-item px-2.5 py-1.5 text-xs font-bold tracking-wide text-left text-[#60809a] hover:text-cyan-400 hover:bg-[#132533]/50 cursor-pointer"
            >
              RENAME
            </button>
          )}
          <button
            onClick={() => {
              if (!contextMenu.confirmingDelete) {
                setContextMenu(m => ({ ...m, confirmingDelete: true }))
                return
              }
              handleDeleteNodes(contextMenu.ids)
              setContextMenu(null)
            }}
            className={`hud-menu-item px-2.5 py-1.5 text-xs font-bold tracking-wide text-left cursor-pointer ${
              contextMenu.confirmingDelete
                ? 'bg-rose-600 text-white border-l-rose-300'
                : 'text-[#60809a] hover:text-rose-500 hover:bg-[#132533]/50'
            }`}
          >
            {contextMenu.confirmingDelete
              ? 'CONFIRM DELETE?'
              : contextMenu.ids.length > 1 ? `DELETE (${contextMenu.ids.length})` : 'DELETE'}
          </button>
        </div>,
        document.body
      )}

      <div className="text-xs text-[#60809a] flex justify-between border-t border-[#1c3547]/40 pt-3 select-none">
        <span>SECURITY // ENCRYPTED_SYS_NET</span>
        <span>BAUD_RATE // 115200</span>
      </div>
    </div>
  )
}

export default MainWidget

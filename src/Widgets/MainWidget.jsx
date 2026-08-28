import { useState, useRef, useEffect, useCallback } from 'react'

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
  // While true, selectionchange events are known to be trailing side effects of our own
  // execCommand calls rather than genuine user action — the toolbar's displayed size/color
  // must ignore them, or the number we just applied gets clobbered back to the old value
  // a moment later. savedRangeRef itself is NOT gated by this — it keeps tracking the
  // live selection throughout, which is what lets +/- keep working on the same highlight
  // without the user having to reselect it between clicks.
  const isApplyingRef = useRef(false)
  const [charCount, setCharCount] = useState(0)
  const [fontSizeInput, setFontSizeInput] = useState(DEFAULT_FONT_SIZE)
  const [activeColorHex, setActiveColorHex] = useState(DEFAULT_COLOR)
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false)
  const [activeFontFamily, setActiveFontFamily] = useState(null)
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false)

  // One-time init: load saved rich text, migrating the old plain-text key if this is
  // the first time this widget runs the rich-text version.
  useEffect(() => {
    const editable = editableRef.current
    if (!editable) return
    const savedHtml = localStorage.getItem('dashboardMainRichText')
    if (savedHtml !== null) {
      editable.innerHTML = savedHtml
    } else {
      const legacyPlainText = localStorage.getItem('dashboardTempText')
      if (legacyPlainText) {
        const span = document.createElement('span')
        span.style.fontSize = `${DEFAULT_FONT_SIZE}px`
        span.style.color = DEFAULT_COLOR
        span.textContent = legacyPlainText
        editable.appendChild(span)
      }
    }
    stripStrayCaretColor(editable)
    localStorage.setItem('dashboardMainRichText', editable.innerHTML)
    setCharCount(editable.textContent.length)
  }, [])

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
    if (!editable) return
    convertLegacyFontTags()
    stripStrayCaretColor(editable)
    localStorage.setItem('dashboardMainRichText', editable.innerHTML)
    setCharCount(editable.textContent.length)
  }, [convertLegacyFontTags])

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

  // Applies to the current selection if there is one, otherwise to whatever gets typed
  // next — same as font size/color pickers in any normal text editor. Legacy execCommand
  // is still the only way to get that "future typing state" behavior without a full
  // editor library, so it wraps the range in a legacy <font size="7"> marker and we swap
  // that for a real <span style="font-size:...">.
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

  return (
    <div className="p-4 flex-grow flex flex-col justify-between overflow-hidden font-sans">
      <div className="flex flex-col gap-2 flex-grow my-2 overflow-hidden">
        <div className="text-xs text-[#60809a] font-bold tracking-widest flex justify-between select-none border-b border-[#1c3547]/30 pb-2">
          <span>INPUT_BUFFER // SECURE_TEXT_LOGGER</span>
          <span>CHARS: {charCount}</span>
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
      </div>

      <div className="text-xs text-[#60809a] flex justify-between border-t border-[#1c3547]/40 pt-3 select-none">
        <span>SECURITY // ENCRYPTED_SYS_NET</span>
        <span>BAUD_RATE // 115200</span>
      </div>
    </div>
  )
}

export default MainWidget

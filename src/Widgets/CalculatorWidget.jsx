import { useState, useRef, useEffect, useCallback } from 'react'
import * as math from 'mathjs'
import { attachDragGhost } from '../utils/dragGhost'

function CalculatorWidget() {
  const [equations, setEquations] = useState(() => {
    const saved = localStorage.getItem('dashboardCalcEqs')
    return saved ? JSON.parse(saved) : ['x^2 + y^2 = 9', 'y = log(x)']
  })
  const [newEqInput, setNewEqInput] = useState('')
  const canvasRef = useRef(null)
  const [graphScale, setGraphScale] = useState(32)
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
  const [draggedEqIndex, setDraggedEqIndex] = useState(null)
  const [isExtremaDropActive, setIsExtremaDropActive] = useState(false)

  useEffect(() => {
    localStorage.setItem('dashboardCalcEqs', JSON.stringify(equations))
  }, [equations])

  // Local zoom keyboard shortcut: "O" to zoom in, "P" to zoom out
  useEffect(() => {
    const handleKeyDown = (e) => {
      const activeEl = document.activeElement
      const isEditingInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')
      if (isEditingInput) return

      if (e.key.toLowerCase() === 'o') {
        setGraphScale(prev => Math.min(128, prev * 1.25))
      } else if (e.key.toLowerCase() === 'p') {
        setGraphScale(prev => Math.max(8, prev / 1.25))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

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

  const drawGraph = (canvas) => {
    if (!canvas || !canvas.parentElement) return
    const ctx = canvas.getContext('2d')
    const width = canvas.width = canvas.parentElement.clientWidth
    const height = canvas.height = Math.max(180, canvas.parentElement.clientHeight - 130)

    ctx.clearRect(0, 0, width, height)
    const centerX = width / 2
    const centerY = height / 2

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

  useEffect(() => {
    if (canvasRef.current) drawGraph(canvasRef.current)
  }, [equations, graphScale, graphCenter, searchedPoints, showExtremaFinder, domainMin, domainMax, resolvedExtrema])

  useEffect(() => {
    const element = canvasRef.current?.parentElement
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (canvasRef.current) drawGraph(canvasRef.current)
    })
    observer.observe(element)
    return () => observer.unobserve(element)
  }, [])

  return (
    <div className="p-4 flex-grow flex flex-col justify-start gap-y-3 overflow-hidden text-sm font-sans">
      <div className="flex-grow relative h-full w-full overflow-hidden rounded bg-[#090e14] border border-[#1c3547]/50 shadow-[0_0_25px_rgba(6,182,212,0.05)]">
        <canvas
          ref={canvasRef}
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
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsExtremaDropActive(true);
              }}
              onDragLeave={() => setIsExtremaDropActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsExtremaDropActive(false);
                const eq = e.dataTransfer.getData("text/plain")
                setExtremaEq(eq)
                setResolvedExtrema(null)
              }}
              className={`border border-dashed rounded p-3 text-center text-[9px] transition-all duration-150 cursor-pointer ${
                isExtremaDropActive
                  ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300 scale-[1.03] shadow-[0_0_16px_rgba(0,210,255,0.25)]'
                  : 'border-cyan-500/30 bg-black/40 text-[#60809a] hover:border-cyan-400 hover:text-cyan-400'
              }`}
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
                    setDraggedEqIndex(idx)
                    attachDragGhost(e, { background: '#0f1c27' })
                  }}
                  onDragEnd={(e) => {
                    e.stopPropagation();
                    setDraggedEqIndex(null)
                  }}
                  className={`flex justify-between items-center bg-[#0c1821]/90 border px-2.5 py-1 rounded min-h-[26px] backdrop-blur-sm cursor-grab active:cursor-grabbing transition-[opacity,transform] duration-150 ${
                    draggedEqIndex === idx ? 'opacity-30 scale-[0.96] border-[#1c3547]/50' : 'border-[#1c3547]/50'
                  }`}
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
                        if (e.detail === 2) {
                          e.stopPropagation();
                          handleStartEdit(idx, eq);
                        }
                      }}
                      className={`text-xs font-bold truncate select-none cursor-pointer ${colors[idx % colors.length]}`}
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
}

export default CalculatorWidget
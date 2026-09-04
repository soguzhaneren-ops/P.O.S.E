import { useState, useEffect, useMemo } from 'react'

// Load secure API key from local environment configuration
const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_API_KEY;

// Strips currency symbols/whitespace and normalizes a European decimal comma (e.g. "0,26")
// to a dot — the comma must survive the symbol strip so this conversion has something to
// act on, otherwise "0,26" silently becomes "026" and parses as 26.
function sanitizeInput(val) {
  return val.replace(/[$€₺\s]/g, '').replace(',', '.')
}

// Live quantity preview under the amount field — trimmed to 8 decimals so a repeating
// float tail (e.g. amount/price landing on 0.1999999999999998) doesn't show as noise.
function formatQtyPreview(qty) {
  return qty.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

// Holdings are derived by replaying the recent transaction log onto a baseline, rather than
// mutated directly — that's what lets editing or deleting a transaction correctly "redo" its
// effect on the portfolio (see the transaction-log state below for why the log itself is
// capped at 6 entries). Same weighted-average-cost-on-buy / qty-reduction-on-sell math the
// old direct-mutation handlers already used, just applied as a fold over the log instead of
// as one-off state updates.
function replayHoldings(baseline, transactions) {
  const holdings = baseline.map(h => ({ ...h }))
  for (const tx of transactions) {
    const idx = holdings.findIndex(h => h.symbol === tx.symbol)
    if (tx.type === 'buy') {
      if (idx >= 0) {
        const existing = holdings[idx]
        const updatedQty = existing.qty + tx.qty
        const updatedCost = ((existing.qty * existing.cost) + (tx.qty * tx.price)) / updatedQty
        holdings[idx] = { symbol: tx.symbol, qty: updatedQty, cost: updatedCost }
      } else {
        holdings.push({ symbol: tx.symbol, qty: tx.qty, cost: tx.price })
      }
    } else if (tx.type === 'sell' && idx >= 0) {
      const existing = holdings[idx]
      const updatedQty = existing.qty - tx.qty
      // Epsilon guard against float dust (e.g. 1.77e-15) landing just above zero and leaving
      // a phantom holding instead of fully closing the position.
      if (updatedQty <= 1e-9) {
        holdings.splice(idx, 1)
      } else {
        holdings[idx] = { ...existing, qty: updatedQty }
      }
    }
  }
  return holdings
}

function MarketWidget({ onLoadingChange, isFocused = false }) {
  // Starred market symbols
  const [starredSymbols, setStarredSymbols] = useState(() => {
    const saved = localStorage.getItem('starredSymbols')
    return saved ? JSON.parse(saved) : ['TSLA', 'AAPL', 'MSFT', 'NVDA']
  })

  // Holdings as of the start of the current transaction log — advances forward only when
  // the log overflows past 6 entries (see addTransaction), absorbing the oldest transaction
  // so it stops being individually editable while keeping its portfolio effect intact.
  const [holdingsBaseline, setHoldingsBaseline] = useState(() => {
    const saved = localStorage.getItem('dashboardHoldingsBaseline')
    if (saved) return JSON.parse(saved)
    // First run of the transaction-log version — the existing aggregate holdings (built up
    // from whatever trades happened before this feature existed, with no per-trade record
    // kept) become the starting baseline. Only trades made from here on get logged.
    const legacyHoldings = localStorage.getItem('dashboardHoldings')
    return legacyHoldings ? JSON.parse(legacyHoldings) : [
      { symbol: 'TSLA', qty: 10, cost: 280.50 },
      { symbol: 'AAPL', qty: 15, cost: 185.20 }
    ]
  })

  // Recent buy/sell log, oldest first (for replay order) — capped at 6 (see addTransaction).
  const [transactions, setTransactions] = useState(() => {
    const saved = localStorage.getItem('dashboardTransactions')
    return saved ? JSON.parse(saved) : []
  })

  // The last up-to-2 transactions folded out of the log, oldest-fold-first, each paired with
  // the baseline snapshot from just before it was folded — lets handleDeleteTransaction pull
  // the most recently folded one back in (restoring that exact baseline) so deleting a
  // transaction doesn't just shrink the log below 6. Capped at 2 per the user's request; a
  // fold older than the last 2 is permanently baked into the baseline and can't come back.
  const [foldedHistory, setFoldedHistory] = useState(() => {
    const saved = localStorage.getItem('dashboardFoldedHistory')
    return saved ? JSON.parse(saved) : []
  })

  // Memoized so this only gets a new array reference when the log or baseline actually
  // change — recomputing (and thus creating a new reference) on every unrelated re-render
  // would re-trigger the market-data polling effect below on every render too, since it
  // depends on `holdings`.
  const holdings = useMemo(() => replayHoldings(holdingsBaseline, transactions), [holdingsBaseline, transactions])

  const [editingTxId, setEditingTxId] = useState(null)
  const [editingTxDraft, setEditingTxDraft] = useState(null)
  const [isTxLogCollapsed, setIsTxLogCollapsed] = useState(() => {
    const saved = localStorage.getItem('dashboardTxLogCollapsed')
    return saved ? JSON.parse(saved) : false
  })

  // Live market data
  const [marketData, setMarketData] = useState({})
  const [marketLoading, setMarketLoading] = useState(true)

  // Watchlist Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchError, setSearchError] = useState('')

  // Portfolio Input states — quantity is never typed directly; the user enters price/share
  // (read straight off their brokerage's own history, already exact) and total amount, and
  // quantity is derived from those (see portComputedQty/sellComputedQty below).
  const [portTicker, setPortTicker] = useState('')
  const [portPrice, setPortPrice] = useState('')
  const [portAmount, setPortAmount] = useState('')
  const [portError, setPortError] = useState('')

  const [sellTicker, setSellTicker] = useState('')
  const [sellPrice, setSellPrice] = useState('')
  const [sellAmount, setSellAmount] = useState('')
  const [sellError, setSellError] = useState('')
  const [portfolioMode, setPortfolioMode] = useState('buy') // 'buy' or 'sell'

  // Tabbed Financial Feed Transition States
  const [marketCategory, setMarketCategory] = useState('WATCHLIST')
  const [displayMarketTab, setDisplayMarketTab] = useState('WATCHLIST')
  const [isMarketFadingOut, setIsMarketFadingOut] = useState(false)
  const [animateMarket, setAnimateMarket] = useState(true)
  const [lastManualMarketClick, setLastManualMarketClick] = useState(() => Date.now())

  useEffect(() => {
    if (onLoadingChange) onLoadingChange(marketLoading)
  }, [marketLoading])

  // Sync operations
  useEffect(() => {
    localStorage.setItem('starredSymbols', JSON.stringify(starredSymbols))
  }, [starredSymbols])

  useEffect(() => {
    localStorage.setItem('dashboardHoldingsBaseline', JSON.stringify(holdingsBaseline))
  }, [holdingsBaseline])

  useEffect(() => {
    localStorage.setItem('dashboardTransactions', JSON.stringify(transactions))
  }, [transactions])

  useEffect(() => {
    localStorage.setItem('dashboardFoldedHistory', JSON.stringify(foldedHistory))
  }, [foldedHistory])

  useEffect(() => {
    localStorage.setItem('dashboardTxLogCollapsed', JSON.stringify(isTxLogCollapsed))
  }, [isTxLogCollapsed])

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
                price: `$${priceVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
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

  useEffect(() => {
    if (!isMarketFadingOut) {
      setAnimateMarket(true)
    }
  }, [isMarketFadingOut])

  // Portfolio tabs Auto-rotation cycle — suppressed entirely while focused. The focal
  // overlay is where the buy/sell forms and transaction log actually get used, and this
  // timer flipping the tab away mid-entry was a real, repeatedly-hit source of lost
  // in-progress form data; disabling it here is strictly additive to that, not a fix for a
  // currently-open bug.
  useEffect(() => {
    if (isFocused) return

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
  }, [lastManualMarketClick, isFocused])

  const handleManualMarketChange = (category) => {
    if (category === displayMarketTab) return
    setLastManualMarketClick(Date.now())
    setAnimateMarket(false)
    setIsMarketFadingOut(false)
    setMarketCategory(category)
    setDisplayMarketTab(category)
  }

  const registerMarketInteraction = () => {
    // eslint-disable-next-line react-hooks/purity -- only ever called from onClick/onChange/onFocus handlers, never during render
    setLastManualMarketClick(Date.now())
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

  // Appends to the log; once it grows past 6, the oldest entry is folded into the baseline
  // (its portfolio effect is preserved) and dropped from the editable/visible log — reading
  // holdingsBaseline/transactions directly off the current render's closure rather than via
  // functional updaters, since nesting a setHoldingsBaseline call inside a setTransactions
  // updater would risk double-applying the fold under React StrictMode's double-invoke.
  const addTransaction = (txInput) => {
    // eslint-disable-next-line react-hooks/purity -- addTransaction is only ever invoked from click handlers / fetch-success callbacks, never during render, so Date.now() here isn't actually reachable from a render pass
    const newTx = { id: crypto.randomUUID(), timestamp: Date.now(), ...txInput }
    const updated = [...transactions, newTx]
    if (updated.length > 6) {
      const [oldest, ...rest] = updated
      const nextFolded = [...foldedHistory, { transaction: oldest, previousBaseline: holdingsBaseline }]
      setFoldedHistory(nextFolded.length > 2 ? nextFolded.slice(nextFolded.length - 2) : nextFolded)
      setHoldingsBaseline(replayHoldings(holdingsBaseline, [oldest]))
      setTransactions(rest)
    } else {
      setTransactions(updated)
    }
  }

  // Deleting doesn't just shrink the log — if a transaction was folded out to make room
  // (see addTransaction), the most recently folded one is pulled back in at the oldest slot
  // (visually the bottom, since the log renders newest-first) so the list stays full. Works
  // regardless of which transaction was deleted, since it's restoring what fell off the far
  // end, not undoing the specific deletion.
  const handleDeleteTransaction = (id) => {
    const remaining = transactions.filter(t => t.id !== id)
    if (foldedHistory.length > 0) {
      const entry = foldedHistory[foldedHistory.length - 1]
      setHoldingsBaseline(entry.previousBaseline)
      setTransactions([entry.transaction, ...remaining])
      setFoldedHistory(foldedHistory.slice(0, -1))
    } else {
      setTransactions(remaining)
    }
  }

  const startEditTransaction = (tx) => {
    // Same reason the buy/sell form inputs already call this: without it, the 20s
    // watchlist/portfolio auto-rotation can flip the tab away mid-edit (unmounting this
    // whole section) and silently discard whatever was being typed.
    registerMarketInteraction()
    setEditingTxId(tx.id)
    // Same price + amount entry as the buy/sell forms, not qty directly — amount is
    // back-derived from the stored qty*price so editing without touching either field is a
    // no-op, and re-typing amount recomputes qty the same way a fresh entry would.
    setEditingTxDraft({ type: tx.type, symbol: tx.symbol, price: String(tx.price), amount: (tx.qty * tx.price).toFixed(2) })
  }

  const cancelEditTransaction = () => {
    setEditingTxId(null)
    setEditingTxDraft(null)
  }

  const isEditingTxDraftValid = editingTxDraft
    && editingTxDraft.symbol.trim()
    && !isNaN(parseFloat(sanitizeInput(editingTxDraft.price))) && parseFloat(sanitizeInput(editingTxDraft.price)) > 0
    && !isNaN(parseFloat(sanitizeInput(editingTxDraft.amount))) && parseFloat(sanitizeInput(editingTxDraft.amount)) > 0

  const editComputedQty = (() => {
    if (!editingTxDraft) return null
    const price = parseFloat(sanitizeInput(editingTxDraft.price))
    const amount = parseFloat(sanitizeInput(editingTxDraft.amount))
    return (!isNaN(price) && price > 0 && !isNaN(amount) && amount > 0) ? amount / price : null
  })()

  const saveEditTransaction = () => {
    if (!isEditingTxDraftValid) return
    const sym = editingTxDraft.symbol.trim().toUpperCase()
    const price = parseFloat(sanitizeInput(editingTxDraft.price))
    const amount = parseFloat(sanitizeInput(editingTxDraft.amount))
    const qty = amount / price
    setTransactions(prev => prev.map(t =>
      t.id === editingTxId ? { ...t, type: editingTxDraft.type, symbol: sym, qty, price } : t
    ))
    setEditingTxId(null)
    setEditingTxDraft(null)
  }

  const handleAddHolding = () => {
    const sym = portTicker.trim().toUpperCase()
    const price = parseFloat(sanitizeInput(portPrice))
    const amount = parseFloat(sanitizeInput(portAmount))
    const qty = amount / price

    if (!sym || isNaN(price) || price <= 0 || isNaN(amount) || amount <= 0) {
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
        addTransaction({ type: 'buy', symbol: sym, qty, price })
        setPortTicker('')
        setPortPrice('')
        setPortAmount('')
        setPortError('')
      })
      .catch(() => {
        setPortError('TKR_ERR // INVALID_SYMBOL')
      })
  }
  const handleSellHolding = () => {
    const sym = sellTicker.trim().toUpperCase()
    const price = parseFloat(sanitizeInput(sellPrice))
    const amount = parseFloat(sanitizeInput(sellAmount))
    let qty = amount / price

    const existing = holdings.find(h => h.symbol === sym)

    if (!sym || isNaN(price) || price <= 0 || isNaN(amount) || amount <= 0) {
      setSellError('VAL_ERR // INVALID_TRANSACTION')
      return
    }
    if (!existing) {
      setSellError('TKR_ERR // NOT_IN_PORTFOLIO')
      return
    }
    // Amount-based entry (especially the SELL ALL shortcut, which rounds the auto-filled
    // amount to the cent) can land a hair above the held quantity from pure float/rounding
    // drift — snap it to the exact held quantity when within a tiny relative tolerance so a
    // genuine full-close isn't rejected or left with a phantom fractional-share residue.
    if (qty > existing.qty && qty <= existing.qty * 1.0001) {
      qty = existing.qty
    }
    if (qty > existing.qty) {
      setSellError(`QTY_ERR // ONLY ${existing.qty} SHARES HELD`)
      return
    }

    addTransaction({ type: 'sell', symbol: sym, qty, price })

    setSellTicker('')
    setSellPrice('')
    setSellAmount('')
    setSellError('')
  }
  // "SELL ALL" shortcut — fills the amount field from the currently-held quantity × the
  // price the user already entered, so closing a position out fully doesn't require the
  // user to do that multiplication themselves (and risk a mismatch with their real shares).
  const handleSellAll = () => {
    registerMarketInteraction()
    const sym = sellTicker.trim().toUpperCase()
    const price = parseFloat(sanitizeInput(sellPrice))
    const existing = holdings.find(h => h.symbol === sym)

    if (!sym || !existing) {
      setSellError('TKR_ERR // NOT_IN_PORTFOLIO')
      return
    }
    if (isNaN(price) || price <= 0) {
      setSellError('VAL_ERR // ENTER_PRICE_FIRST')
      return
    }
    setSellAmount((existing.qty * price).toFixed(2))
    setSellError('')
  }
  // Closes the position out entirely as a sell transaction at the current market price (or
  // cost basis if a live price isn't available) — same effect the old direct-removal button
  // had, but now flowing through the log so it's just as editable/undoable as any other trade.
  const handleRemoveHolding = (sym) => {
    const existing = holdings.find(h => h.symbol === sym)
    if (!existing) return
    const rawTickerData = marketData[sym]
    const currentPrice = rawTickerData && !rawTickerData.error
      ? parseFloat(rawTickerData.price.replace(/[^0-9.]/g, ''))
      : existing.cost
    addTransaction({ type: 'sell', symbol: sym, qty: existing.qty, price: currentPrice })
  }

  const portPriceNum = parseFloat(sanitizeInput(portPrice))
  const portAmountNum = parseFloat(sanitizeInput(portAmount))
  const portComputedQty = (!isNaN(portPriceNum) && portPriceNum > 0 && !isNaN(portAmountNum) && portAmountNum > 0)
    ? portAmountNum / portPriceNum
    : null

  const sellPriceNum = parseFloat(sanitizeInput(sellPrice))
  const sellAmountNum = parseFloat(sanitizeInput(sellAmount))
  const sellComputedQty = (!isNaN(sellPriceNum) && sellPriceNum > 0 && !isNaN(sellAmountNum) && sellAmountNum > 0)
    ? sellAmountNum / sellPriceNum
    : null

  const isMarketContentHidden = animateMarket ? isMarketFadingOut : false

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
                    <span className="w-[40%] text-left pl-2">VALUE_USD</span>
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
                <div className="text-cyan-100 font-extrabold text-base lg:text-lg">${totalCurrentValSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="text-right">
                <div className="text-[#60809a] font-bold text-[9px] tracking-widest uppercase">TOTAL_RETURN</div>
                <div className={`font-extrabold text-xs lg:text-sm ${globalProfitLossUSD >= 0 ? 'text-emerald-400' : 'text-rose-500'}`}>
                  {globalProfitLossUSD >= 0 ? '+' : ''}${globalProfitLossUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({globalProfitLossUSD >= 0 ? '+' : ''}{globalProfitLossPct.toFixed(2)}%)
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
                  placeholder="PRICE/SHARE"
                  value={portPrice}
                  onChange={(e) => {
                    setPortPrice(e.target.value)
                    registerMarketInteraction()
                  }}
                  onFocus={registerMarketInteraction}
                  className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#00d2ff] flex-grow"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="AMOUNT_USD"
                  value={portAmount}
                  onChange={(e) => {
                    setPortAmount(e.target.value)
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
              <div className="text-[10px] text-[#60809a] tracking-wider min-h-[14px]">
                {portComputedQty !== null && <>QTY ≈ {formatQtyPreview(portComputedQty)}</>}
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
                  placeholder="PRICE/SHARE"
                  value={sellPrice}
                  onChange={(e) => {
                    setSellPrice(e.target.value)
                    registerMarketInteraction()
                  }}
                  onFocus={registerMarketInteraction}
                  className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#d07018] flex-grow"
                />
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="AMOUNT_USD"
                  value={sellAmount}
                  onChange={(e) => {
                    setSellAmount(e.target.value)
                    registerMarketInteraction()
                  }}
                  onFocus={registerMarketInteraction}
                  onKeyDown={(e) => e.key === 'Enter' && handleSellHolding()}
                  className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#d07018] flex-grow"
                />
                <button
                  onClick={handleSellAll}
                  title="Fill amount from full held quantity × price"
                  className="bg-[#090e14] hover:bg-[#1c1410] active:bg-[#d07018] active:text-black border border-[#d07018]/30 text-[#d07018]/80 hover:text-[#d07018] text-[10px] font-bold px-2 rounded transition-all cursor-pointer"
                >
                  ALL
                </button>
                <button
                  onClick={handleSellHolding}
                  className="bg-[#2a1410] hover:bg-[#3a1c15] active:bg-[#d07018] active:text-black border border-[#d07018]/40 text-[#d07018] text-xs px-3 rounded font-bold transition-all cursor-pointer"
                >
                  SELL
                </button>
              </div>
              <div className="text-[10px] text-[#60809a] tracking-wider min-h-[14px]">
                {sellComputedQty !== null && <>QTY ≈ {formatQtyPreview(sellComputedQty)}</>}
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
                    <span className="w-[27%] text-center">VALUE_USD</span>
                    <span className="w-[20%] text-right">RETURN%</span>
                    <span className="w-[8%]"></span>
                  </div>

                  {processedHoldingsList.map(h => (
                    <div key={h.symbol} className="flex justify-between items-center text-xs lg:text-sm">
                      <span className="text-[#60809a] font-bold w-[22%] text-left whitespace-nowrap overflow-hidden text-ellipsis">[ {h.symbol} ]</span>
                      <span className="w-[23%] text-center text-cyan-200 font-semibold truncate" title={h.qty}>{h.qty}</span>
                      <span className="w-[27%] text-center text-cyan-100 font-semibold truncate">${h.currentValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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

            {isFocused && (
              <div className="shrink-0 border-t border-[#1c3547]/20 pt-2.5">
                <div className="flex justify-between items-center mb-1.5">
                  <div className="text-[9px] font-bold tracking-widest text-[#3d5b73]">// TRANSACTION_LOG</div>
                  <button
                    onClick={() => setIsTxLogCollapsed(v => !v)}
                    className="text-[9px] font-bold tracking-widest text-[#60809a] hover:text-cyan-400 cursor-pointer focus:outline-none"
                  >
                    {isTxLogCollapsed ? '[ SHOW ]' : '[ HIDE ]'}
                  </button>
                </div>
                {isTxLogCollapsed ? null : transactions.length === 0 ? (
                  <div className="text-[10px] text-cyan-700 italic select-none py-2 text-center">
                    NO_RECENT_TRANSACTIONS
                  </div>
                ) : (
                  <>
                    <div className="text-[9px] text-[#60809a] flex justify-between font-bold select-none mb-1 tracking-widest">
                      <span className="w-[13%] text-center">TYPE</span>
                      <span className="w-[18%] text-left">TICKER</span>
                      <span className="w-[14%] text-center">QTY</span>
                      <span className="w-[18%] text-center">PRICE/SH</span>
                      <span className="w-[22%] text-center">AMOUNT</span>
                      <span className="w-[15%]"></span>
                    </div>
                    <div className="space-y-1">
                      {[...transactions].reverse().map(tx => (
                        editingTxId === tx.id ? (
                          <div key={tx.id} className="flex flex-col gap-1 bg-[#0e1a24]/60 border border-cyan-500/30 rounded px-1.5 py-1.5">
                            <div className="flex items-center gap-1">
                              <select
                                value={editingTxDraft.type}
                                onChange={(e) => { setEditingTxDraft(d => ({ ...d, type: e.target.value })); registerMarketInteraction() }}
                                onFocus={registerMarketInteraction}
                                className="bg-[#090e14] border border-[#1c3547] text-[10px] text-cyan-100 rounded px-0.5 py-0.5 focus:outline-none"
                              >
                                <option value="buy">BUY</option>
                                <option value="sell">SELL</option>
                              </select>
                              <input
                                type="text"
                                value={editingTxDraft.symbol}
                                onChange={(e) => { setEditingTxDraft(d => ({ ...d, symbol: e.target.value })); registerMarketInteraction() }}
                                onFocus={registerMarketInteraction}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditTransaction()
                                  if (e.key === 'Escape') cancelEditTransaction()
                                }}
                                className="bg-[#090e14] border border-[#1c3547] text-[10px] text-cyan-100 rounded px-1 py-0.5 w-12 uppercase focus:outline-none"
                              />
                              <input
                                type="text"
                                value={editingTxDraft.price}
                                onChange={(e) => { setEditingTxDraft(d => ({ ...d, price: e.target.value })); registerMarketInteraction() }}
                                onFocus={registerMarketInteraction}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditTransaction()
                                  if (e.key === 'Escape') cancelEditTransaction()
                                }}
                                placeholder="PRICE/SH"
                                className="bg-[#090e14] border border-[#1c3547] text-[10px] text-cyan-100 rounded px-1 py-0.5 flex-grow min-w-0 focus:outline-none"
                              />
                            </div>
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={editingTxDraft.amount}
                                onChange={(e) => { setEditingTxDraft(d => ({ ...d, amount: e.target.value })); registerMarketInteraction() }}
                                onFocus={registerMarketInteraction}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditTransaction()
                                  if (e.key === 'Escape') cancelEditTransaction()
                                }}
                                placeholder="AMOUNT"
                                className="bg-[#090e14] border border-[#1c3547] text-[10px] text-cyan-100 rounded px-1 py-0.5 flex-grow min-w-0 focus:outline-none"
                              />
                              <button
                                onClick={saveEditTransaction}
                                disabled={!isEditingTxDraftValid}
                                className="text-emerald-400 hover:text-emerald-300 disabled:text-[#60809a]/30 disabled:cursor-not-allowed text-xs font-bold px-1 cursor-pointer"
                              >
                                ✓
                              </button>
                              <button
                                onClick={cancelEditTransaction}
                                className="text-[#60809a] hover:text-rose-500 text-xs font-bold px-1 cursor-pointer"
                              >
                                ✕
                              </button>
                            </div>
                            <div className="text-[9px] text-[#60809a] tracking-wider">
                              {editComputedQty !== null && <>QTY ≈ {formatQtyPreview(editComputedQty)}</>}
                            </div>
                          </div>
                        ) : (
                          <div key={tx.id} className="flex justify-between items-center text-[10px] lg:text-xs">
                            <span className={`w-[13%] text-center font-bold rounded px-1 py-0.5 ${
                              tx.type === 'buy' ? 'text-cyan-400 bg-cyan-500/10' : 'text-[#d07018] bg-[#d07018]/10'
                            }`}>
                              {tx.type === 'buy' ? 'BUY' : 'SELL'}
                            </span>
                            <span className="text-[#60809a] font-bold w-[18%] text-left truncate">[ {tx.symbol} ]</span>
                            <span className="text-cyan-200 w-[14%] text-center truncate" title={tx.qty}>{tx.qty}</span>
                            <span className="text-cyan-100 w-[18%] text-center truncate">
                              ${Number(tx.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-cyan-100 font-semibold w-[22%] text-center truncate">
                              ${(tx.qty * tx.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="w-[15%] flex justify-end gap-1.5">
                              <button
                                onClick={() => startEditTransaction(tx)}
                                className="text-[#60809a]/50 hover:text-cyan-400 text-[10px] cursor-pointer"
                                title="EDIT"
                              >
                                ✎
                              </button>
                              <button
                                onClick={() => handleDeleteTransaction(tx.id)}
                                className="text-[#60809a]/50 hover:text-rose-500 text-[10px] font-bold cursor-pointer"
                                title="DELETE"
                              >
                                ✕
                              </button>
                            </span>
                          </div>
                        )
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default MarketWidget

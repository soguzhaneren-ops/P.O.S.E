import { useState, useEffect } from 'react'

// Load secure API key from local environment configuration
const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_API_KEY;

function MarketWidget({ onLoadingChange }) {
  // Starred market symbols
  const [starredSymbols, setStarredSymbols] = useState(() => {
    const saved = localStorage.getItem('starredSymbols')
    return saved ? JSON.parse(saved) : ['TSLA', 'AAPL', 'MSFT', 'NVDA']
  })

  // Active Portfolio holdings state
  const [holdings, setHoldings] = useState(() => {
    const saved = localStorage.getItem('dashboardHoldings')
    return saved ? JSON.parse(saved) : [
      { symbol: 'TSLA', qty: 10, cost: 280.50 },
      { symbol: 'AAPL', qty: 15, cost: 185.20 }
    ]
  })

  // Live market data
  const [marketData, setMarketData] = useState({})
  const [marketLoading, setMarketLoading] = useState(true)

  // Watchlist Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchError, setSearchError] = useState('')

  // Portfolio Input states
  const [portTicker, setPortTicker] = useState('')
  const [portQty, setPortQty] = useState('')
  const [portPrice, setPortPrice] = useState('')
  const [portError, setPortError] = useState('')

  const [sellTicker, setSellTicker] = useState('')
  const [sellQty, setSellQty] = useState('')
  const [sellPrice, setSellPrice] = useState('')
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
    localStorage.setItem('dashboardHoldings', JSON.stringify(holdings))
  }, [holdings])

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

  // Portfolio tabs Auto-rotation cycle
  useEffect(() => {
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
  }, [lastManualMarketClick])

  const handleManualMarketChange = (category) => {
    if (category === displayMarketTab) return
    setLastManualMarketClick(Date.now())
    setAnimateMarket(false)
    setIsMarketFadingOut(false)
    setMarketCategory(category)
    setDisplayMarketTab(category)
  }

  const registerMarketInteraction = () => {
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

  const handleAddHolding = () => {
    const sanitizeInput = (val) => val.replace(/[$,€,₺,\s]/g, '').replace(',', '.')
    const sym = portTicker.trim().toUpperCase()
    const qty = parseFloat(sanitizeInput(portQty))
    const price = parseFloat(sanitizeInput(portPrice))

    if (!sym || isNaN(qty) || qty <= 0 || isNaN(price) || price <= 0) {
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
        setHoldings(prev => {
          const existingIndex = prev.findIndex(h => h.symbol === sym)
          if (existingIndex >= 0) {
            const existing = prev[existingIndex]
            const updatedQty = existing.qty + qty
            const updatedCostBasis = ((existing.qty * existing.cost) + (qty * price)) / updatedQty
            const copy = [...prev]
            copy[existingIndex] = { symbol: sym, qty: updatedQty, cost: updatedCostBasis }
            return copy
          } else {
            return [...prev, { symbol: sym, qty, cost: price }]
          }
        })
        setPortTicker('')
        setPortQty('')
        setPortPrice('')
        setPortError('')
      })
      .catch(() => {
        setPortError('TKR_ERR // INVALID_SYMBOL')
      })
  }
  const handleSellHolding = () => {
    const sanitizeInput = (val) => val.replace(/[$,€,₺,\s]/g, '').replace(',', '.')
    const sym = sellTicker.trim().toUpperCase()
    const qty = parseFloat(sanitizeInput(sellQty))

    const existing = holdings.find(h => h.symbol === sym)

    if (!sym || isNaN(qty) || qty <= 0) {
      setSellError('VAL_ERR // INVALID_TRANSACTION')
      return
    }
    if (!existing) {
      setSellError('TKR_ERR // NOT_IN_PORTFOLIO')
      return
    }
    if (qty > existing.qty) {
      setSellError(`QTY_ERR // ONLY ${existing.qty} SHARES HELD`)
      return
    }

    setHoldings(prev => {
      const remaining = existing.qty - qty
      if (remaining <= 0) {
        return prev.filter(h => h.symbol !== sym)
      }
      return prev.map(h =>
        h.symbol === sym ? { ...h, qty: remaining } : h
      )
    })

    setSellTicker('')
    setSellQty('')
    setSellPrice('')
    setSellError('')
  }
  const handleRemoveHolding = (sym) => {
    setHoldings(prev => prev.filter(h => h.symbol !== sym))
  }

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
                  placeholder="QTY"
                  value={portQty}
                  onChange={(e) => {
                    setPortQty(e.target.value)
                    registerMarketInteraction()
                  }}
                  onFocus={registerMarketInteraction}
                  className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#00d2ff] w-14"
                />
                <input
                  type="text"
                  placeholder="PRICE_USD"
                  value={portPrice}
                  onChange={(e) => {
                    setPortPrice(e.target.value)
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
                  placeholder="QTY"
                  value={sellQty}
                  onChange={(e) => {
                    setSellQty(e.target.value)
                    registerMarketInteraction()
                  }}
                  onFocus={registerMarketInteraction}
                  className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#d07018] w-14"
                />
                <input
                  type="text"
                  placeholder="PRICE_USD"
                  value={sellPrice}
                  onChange={(e) => {
                    setSellPrice(e.target.value)
                    registerMarketInteraction()
                  }}
                  onFocus={registerMarketInteraction}
                  onKeyDown={(e) => e.key === 'Enter' && handleSellHolding()}
                  className="bg-[#090e14] border border-[#1c3547] text-cyan-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-[#d07018] flex-grow"
                />
                <button
                  onClick={handleSellHolding}
                  className="bg-[#2a1410] hover:bg-[#3a1c15] active:bg-[#d07018] active:text-black border border-[#d07018]/40 text-[#d07018] text-xs px-3 rounded font-bold transition-all cursor-pointer"
                >
                  SELL
                </button>
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
          </div>
        )}
      </div>
    </div>
  )
}

export default MarketWidget

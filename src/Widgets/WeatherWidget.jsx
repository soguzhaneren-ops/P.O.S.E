import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'

const WEATHER_CACHE_KEY = 'dashboardWeatherCache'
// ipinfo.io's free tier is unauthenticated and tightly rate-limited — refetching on every
// single mount (every app launch, every dev rebuild/restart) burns through it fast, which is
// exactly what produced a stretch of real 429s during heavy same-day testing. IP-resolved
// location and current weather don't meaningfully change within a few hours, so serving a
// cached read is just as correct and costs zero requests.
const CACHE_TTL_MS = 3 * 60 * 60 * 1000

function readWeatherCache() {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.weather) return null
    return parsed
  } catch {
    return null
  }
}

function writeWeatherCache(weatherData) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ weather: weatherData, savedAt: Date.now() }))
  } catch {
    // Caching is a nice-to-have; a full/unavailable localStorage shouldn't break the fetch itself.
  }
}

const DEFAULT_WEATHER = {
  temp: '--.-',
  status: 'SYS_INITIALIZING',
  locationName: 'DETECTING STATION...',
  forecast: [],
  loading: true
}

// A fresh cache is loaded straight into initial state, not set from a mount effect — so a
// cache hit renders the real data on the very first paint, with no fetch and no flash of
// the loading placeholder above.
function buildInitialWeather() {
  const cached = readWeatherCache()
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return { ...cached.weather, loading: false }
  }
  return DEFAULT_WEATHER
}

// showHeaderRefresh controls the widget's own inline REFRESH button (used in the focal
// overlay, which has no WidgetShell header for a hosted button to sit in). When the shell
// hosts the button instead (see App.jsx's headerActions), this is set to false and the
// trigger/state are exposed via ref + onRefreshingChange so the shell's button stays in sync.
const WeatherWidget = forwardRef(function WeatherWidget({ onLoadingChange, onRefreshingChange, showHeaderRefresh = true }, ref) {
  const [weather, setWeather] = useState(buildInitialWeather)
  const [locationError, setLocationError] = useState(null)
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)
  const weatherRef = useRef(null)
  const [weatherHeight, setWeatherHeight] = useState(350)

  useEffect(() => {
    if (onLoadingChange) onLoadingChange(weather.loading)
  }, [weather.loading])

  useEffect(() => {
    const element = weatherRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setWeatherHeight(entry.contentRect.height)
      }
    })
    observer.observe(element)
    return () => observer.unobserve(element)
  }, [])

  const fetchDashboardData = async (lat, lon) => {
    try {
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto`
      const geocodeUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`

      const [weatherRes, geocodeRes] = await Promise.all([
        fetch(weatherUrl),
        fetch(geocodeUrl)
      ])

      if (!weatherRes.ok) throw new Error()
      const weatherData = await weatherRes.json()

      let resolvedLocation = 'LOCAL_STATION'
      if (geocodeRes.ok) {
        const geocodeData = await geocodeRes.json()
        const city = geocodeData.city || geocodeData.locality || 'STATION'
        const country = geocodeData.countryCode || 'LOC'
        resolvedLocation = `${city.toUpperCase()}, ${country.toUpperCase()}`
      }

      const currentTemp = weatherData.current.temperature_2m
      const currentWeatherCode = weatherData.current.weather_code

      let statusLabel = 'CLEAR SKY'
      if (currentWeatherCode === 1 || currentWeatherCode === 2 || currentWeatherCode === 3) {
        statusLabel = 'PARTLY CLOUDY'
      } else if (currentWeatherCode >= 45 && currentWeatherCode <= 48) {
        statusLabel = 'FOG WARNING'
      } else if (currentWeatherCode >= 51 && currentWeatherCode <= 67) {
        statusLabel = 'RAIN ACTIVE'
      } else if (currentWeatherCode >= 71 && currentWeatherCode <= 77) {
        statusLabel = 'SNOW ACTIVE'
      } else if (currentWeatherCode >= 80) {
        statusLabel = 'STORM DETECTED'
      }

      const forecastList = []
      for (let i = 0; i < 5; i++) {
        const dateStr = weatherData.daily.time[i]
        const tempMax = weatherData.daily.temperature_2m_max[i]
        const tempMin = weatherData.daily.temperature_2m_min[i]
        const code = weatherData.daily.weather_code[i]

        let cond = 'CLEAR'
        if (code >= 1 && code <= 3) cond = 'CLOUDY'
        else if (code >= 45 && code <= 48) cond = 'FOGGY'
        else if (code >= 51 && code <= 67) cond = 'RAIN'
        else if (code >= 71 && code <= 77) cond = 'SNOW'
        else if (code >= 80) cond = 'STORMY'

        const dateObj = new Date(dateStr + "T00:00:00")
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()

        forecastList.push({
          day: dayName,
          max: Math.round(tempMax),
          min: Math.round(tempMin),
          cond: cond
        })
      }

      const resolved = {
        temp: `${currentTemp.toFixed(1)}°C`,
        status: statusLabel,
        locationName: resolvedLocation,
        forecast: forecastList,
        loading: false
      }
      setWeather(resolved)
      writeWeatherCache(resolved)
    } catch {
      setWeather({
        temp: 'ERR',
        status: 'CONNECTION_FAILED',
        locationName: 'OFFLINE_MODE',
        forecast: [],
        loading: false
      })
    }
  }

  const getVisibleDaysCount = (height) => {
    if (height < 210) return 0
    if (height < 235) return 1
    if (height < 260) return 2
    if (height < 285) return 3
    if (height < 310) return 4
    return 5
  }
  const visibleDaysCount = getVisibleDaysCount(weatherHeight)

  // Shared by both the mount effect (when the cache is missing/stale) and the manual
  // refresh button (which always calls this regardless of cache age).
  const resolveLocationAndWeather = async () => {
    try {
      const res = await fetch('https://ipinfo.io/json')
      if (!res.ok) throw new Error('IP lookup failed')
      const data = await res.json()
      if (!data.loc) {
        setLocationError('Could not resolve location from IP')
        return
      }
      const [lat, lon] = data.loc.split(',').map(Number)
      await fetchDashboardData(lat, lon)
    } catch (err) {
      console.error('IP geolocation failed:', err)
      setLocationError('Location lookup failed')
    }
  }

  useEffect(() => {
    // A fresh cache was already loaded into initial state (see buildInitialWeather above) —
    // only reach out to the network here when there was nothing usable to start from.
    const cached = readWeatherCache()
    if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- false positive: every setState inside resolveLocationAndWeather happens after an `await`, in a later microtask, not synchronously within this effect body — the same standard async-fetch-on-mount pattern the original inline fetch().then() chain already used
    resolveLocationAndWeather()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount only; resolveLocationAndWeather is recreated each render but only ever invoked here at mount time
  }, [])

  const handleManualRefresh = async () => {
    if (isManualRefreshing) return
    setIsManualRefreshing(true)
    setLocationError(null)
    await resolveLocationAndWeather()
    setIsManualRefreshing(false)
  }

  useEffect(() => {
    onRefreshingChange?.(isManualRefreshing)
  }, [isManualRefreshing])

  useImperativeHandle(ref, () => ({ refresh: handleManualRefresh }))

  return (
    <div className="p-4 flex-grow flex flex-col justify-start gap-y-4 overflow-hidden text-cyan-400 font-sans">
      {locationError ? (
        <div className="flex-grow flex flex-col items-center justify-center text-center gap-2">
          <div className="text-red-400 text-sm font-bold tracking-wider">LOCATION UNAVAILABLE</div>
          <div className="text-[#60809a] text-xs">{locationError.toUpperCase()}</div>
          <button
            onClick={handleManualRefresh}
            disabled={isManualRefreshing}
            className="mt-2 flex items-center gap-1.5 text-xs bg-cyan-950/40 hover:bg-[#132533] text-[#60809a] hover:text-cyan-400 border border-[#1c3547] hover:border-cyan-500/40 px-2.5 py-1.5 rounded select-none transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
          >
            <span className={isManualRefreshing ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
            {isManualRefreshing ? 'SYNCING...' : 'RETRY'}
          </button>
        </div>
      ) : (
        <>
          <div className="flex justify-between items-start">
            <div>
              <div className="text-5xl lg:text-7xl font-bold tracking-tight text-cyan-100 select-none leading-none">
                {weather.temp}
              </div>
              <div className="text-xs text-[#60809a] mt-2 space-y-1">
                <div className="font-semibold text-cyan-500 text-sm">{weather.locationName}</div>
                <div>STATUS // {weather.status}</div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="text-xs bg-cyan-950/40 text-[#60809a] border border-[#1c3547] px-2 py-1 rounded select-none">
                SYS_ENV_LNK
              </div>
              {showHeaderRefresh && (
                <button
                  onClick={handleManualRefresh}
                  disabled={isManualRefreshing}
                  title="FORCE_REFRESH"
                  className="flex items-center gap-1 text-[10px] font-bold bg-cyan-950/40 hover:bg-[#132533] text-[#60809a] hover:text-cyan-400 border border-[#1c3547] hover:border-cyan-500/40 px-2 py-1 rounded select-none transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                >
                  <span className={isManualRefreshing ? 'inline-block animate-spin' : 'inline-block'}>↻</span>
                  {isManualRefreshing ? 'SYNCING' : 'REFRESH'}
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-cyan-500/10"></div>
          <div ref={weatherRef} className="space-y-1.5 flex-grow overflow-auto">
            <div className="text-xs text-[#60809a] flex justify-between font-bold px-1 select-none mb-1">
              <span>DAY</span>
              <span>HI / LO</span>
              <span>COND</span>
            </div>
            {weather.forecast.slice(0, visibleDaysCount).map((item, index) => {
              const isHighlighted = index === 1;
              return (
                <div
                  key={index}
                  className={`flex justify-between items-center px-3 py-2 text-xs border transition-colors duration-150 ${
                    isHighlighted
                      ? 'bg-[#d07018] text-[#090e14] border-[#d07018] font-bold'
                      : 'bg-[#0e1a24]/50 text-cyan-400 border-[#1c3547]/40'
                  }`}
                >
                  <span className={isHighlighted ? 'text-black' : 'text-[#60809a]'}>[ {item.day} ]</span>
                  <span>{item.max}° / {item.min}°</span>
                  <span className={`font-bold ${isHighlighted ? 'text-black' : 'text-[#00d2ff]'}`}>{item.cond}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
})

export default WeatherWidget

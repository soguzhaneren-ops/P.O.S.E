import { useState, useEffect } from 'react'

function MainWidget() {
  const [tempText, setTempText] = useState(() => {
    return localStorage.getItem('dashboardTempText') || ''
  })

  useEffect(() => {
    localStorage.setItem('dashboardTempText', tempText)
  }, [tempText])

  return (
    <div className="p-4 flex-grow flex flex-col justify-between overflow-hidden font-sans">
      <div className="flex flex-col gap-2 flex-grow my-2 overflow-hidden">
        <div className="text-xs text-[#60809a] font-bold tracking-widest flex justify-between select-none border-b border-[#1c3547]/30 pb-2">
          <span>INPUT_BUFFER // SECURE_TEXT_LOGGER</span>
          <span>CHARS: {tempText.length}</span>
        </div>
        <textarea
          placeholder="AWAITING INPUT_ ENTER SYSTEM LOGS OR SECURE NOTES HERE..."
          value={tempText}
          onChange={(e) => setTempText(e.target.value)}
          className="w-full h-full bg-[#090e14]/50 border border-[#1c3547] text-cyan-500/70 p-3 rounded text-lg lg:text-xl font-bold focus:outline-none focus:border-[#00d2ff] focus:shadow-[0_0_10px_rgba(0,210,255,0.08)] resize-none leading-relaxed transition-all duration-300 font-sans"
        />
      </div>

      <div className="text-xs text-[#60809a] flex justify-between border-t border-[#1c3547]/40 pt-3 select-none">
        <span>SECURITY // ENCRYPTED_SYS_NET</span>
        <span>BAUD_RATE // 115200</span>
      </div>
    </div>
  )
}

export default MainWidget

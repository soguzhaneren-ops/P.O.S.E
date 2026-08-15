import React from 'react'

class WidgetErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error(`Widget "${this.props.widgetName}" crashed:`, error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 flex-grow flex flex-col items-center justify-center text-center gap-3 text-cyan-400 font-sans">
          <div className="text-red-400 text-sm font-bold tracking-wider">
            MODULE_FAULT // {this.props.widgetName?.toUpperCase() || 'UNKNOWN'}
          </div>
          <div className="text-[#60809a] text-xs">
            This box crashed but the rest of your system is fine.
          </div>
          <button
            onClick={this.handleReset}
            className="px-3 py-1.5 rounded border border-[#1c3547] text-[10px] font-bold tracking-widest text-[#60809a] hover:text-cyan-400 hover:border-[#00d2ff] transition-all cursor-pointer"
          >
            [ RESTART_MODULE ]
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default WidgetErrorBoundary
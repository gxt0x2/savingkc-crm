'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * FBK-02: Auto error logging via React Error Boundary
 * Catches unhandled errors and logs them to the API
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to API
    this.logError(error, errorInfo)
  }

  async logError(error: Error, errorInfo: React.ErrorInfo) {
    try {
      await fetch('/api/error/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error_type: 'frontend_crash',
          message: error.message,
          stack_trace: error.stack || errorInfo.componentStack,
          page_url: window.location.href,
        }),
      })
    } catch (err) {
      console.error('Failed to log error:', err)
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-lg">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-2xl font-black text-primary mb-2">Something went wrong</h1>
              <p className="text-sm text-on-surface-variant mb-6">
                We've logged the error and will look into it. Try refreshing the page.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-3 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition-all active:scale-95"
              >
                Refresh Page
              </button>
            </div>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mt-6 p-4 bg-slate-100 rounded-lg">
                <div className="text-xs font-bold text-red-600 mb-1">DEV ERROR:</div>
                <div className="text-xs font-mono text-slate-700">{this.state.error.message}</div>
              </div>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

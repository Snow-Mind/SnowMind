"use client"
import { Component, type ReactNode } from "react"

interface Props { children: ReactNode; name?: string; showEmergencyLink?: boolean }
interface State { hasError: boolean; error?: Error }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name}]`, error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="crystal-card p-6 border border-crimson/30 text-center">
          <p className="text-arctic/70 text-sm mb-3">
            This section encountered an error. Your funds are safe.
          </p>
          <div className="flex items-center justify-center gap-4">
            <button
              className="text-glacier text-sm underline"
              onClick={() => this.setState({ hasError: false })}
            >
              Retry
            </button>
            {this.props.showEmergencyLink && (
              <a
                href="/dashboard#emergency"
                className="text-crimson/80 text-sm underline hover:text-crimson"
              >
                Emergency Withdraw
              </a>
            )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

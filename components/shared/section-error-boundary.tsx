"use client"

import { Component, ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ErrorState } from "./error-state"

interface SectionErrorBoundaryProps {
  children: ReactNode
  message?: string
  /** Optional className forwarded to the inline ErrorState. */
  className?: string
}

interface SectionErrorBoundaryState {
  error: Error | null
}

/**
 * Section-level error boundary for server components wrapped in `<Suspense>`.
 *
 * Pairs with the AD-2 Server Component + Suspense floor: when an async server
 * section throws, this boundary renders the canonical `ErrorState` with a
 * retry button that clears local state and calls `router.refresh()` to re-run
 * server queries (never a silent null gap — H9/H1).
 *
 * Usage:
 *   <Suspense fallback={<ChartSkeleton />}>
 *     <SectionErrorBoundary>
 *       <AsyncServerComponent />
 *     </SectionErrorBoundary>
 *   </Suspense>
 */
export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): SectionErrorBoundaryState {
    return { error }
  }

  // Log once so server-side stack traces aren't swallowed silently (H1).
  componentDidCatch(error: Error) {
    console.error("[SectionErrorBoundary]", error)
  }

  handleRetry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      // The retry child needs the router, which is a hook → tiny client child.
      return (
        <ErrorStateRetry
          onRetry={this.handleRetry}
          message={this.props.message}
          className={this.props.className}
        />
      )
    }
    return this.props.children
  }
}

function ErrorStateRetry({
  onRetry,
  message,
  className,
}: {
  onRetry: () => void
  message?: string
  className?: string
}) {
  const router = useRouter()
  const retry = () => {
    onRetry() // clear boundary state
    router.refresh() // re-fetch server data
  }
  return <ErrorState message={message} onRetry={retry} className={className} />
}
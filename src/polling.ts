import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { loadSnapshot, mergeRefresh, type RequestState } from './request-state.ts'

/** Incremented by the header refresh control; every poller refetches when it changes. */
export const RefreshContext = createContext(0)

export type Polled<T> = RequestState<T> & { refreshing: boolean; refresh: () => void }

export function usePolling<T>(path: string, intervalMs = 15_000): Polled<T> {
  const [state, setState] = useState<RequestState<T>>({ status: 'pending' })
  const [refreshing, setRefreshing] = useState(false)
  const tick = useContext(RefreshContext)
  const mounted = useRef(true)

  const load = useCallback(async (fresh = false) => {
    setRefreshing(true)
    const next = await loadSnapshot<T>(fresh ? `${path}${path.includes('?') ? '&' : '?'}fresh=1` : path)
    if (!mounted.current) return
    setState((previous) => mergeRefresh(previous, next))
    setRefreshing(false)
  }, [path])

  useEffect(() => {
    mounted.current = true
    void load(tick > 0)
    return () => { mounted.current = false }
  }, [load, tick])

  useEffect(() => {
    if (intervalMs <= 0) return
    const timer = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) void load() }, intervalMs)
    return () => clearInterval(timer)
  }, [load, intervalMs])

  return { ...state, refreshing, refresh: () => { void load(true) } } as Polled<T>
}

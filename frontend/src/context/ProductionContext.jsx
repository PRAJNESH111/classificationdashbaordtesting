import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'
import {
  STAGES,
  addAlert,
  ingestCompletedCycles,
  readAlerts,
  readIdleTracking,
  readStageMetrics,
  writeIdleTracking,
} from '../utils/productionMetrics'
import { ProductionContext } from './productionContextStore'
import { STAGE_LABELS } from '../utils/productionFormatters'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const DETECTION = import.meta.env.VITE_DETECTION_URL || 'http://localhost:8000'
const SIGNALR = import.meta.env.VITE_SIGNALR_URL || `${API}/hubs/monitoring`
const STATION = 'BAY 1 — BOX FOLDING'
const EMPTY_STATUS = { state: 'unavailable', processState: 'waiting', detections: [], updatedAt: null, activeCycle: null }

async function fetchCycleHistory() {
  const pageSize = 200
  const firstResponse = await fetch(`${API}/api/cycles?page=1&pageSize=${pageSize}`)
  if (!firstResponse.ok) return []
  const firstPage = await firstResponse.json()
  const items = [...(firstPage.items || [])]
  const pages = Math.ceil((firstPage.total || items.length) / pageSize)
  for (let page = 2; page <= pages; page += 5) {
    const requested = Array.from({ length: Math.min(5, pages - page + 1) }, (_, offset) => page + offset)
    const results = await Promise.all(requested.map(index => fetch(`${API}/api/cycles?page=${index}&pageSize=${pageSize}`).then(response => response.ok ? response.json() : { items: [] })))
    results.forEach(result => items.push(...(result.items || [])))
  }
  return [...new Map(items.filter(cycle => cycle.cycleId).map(cycle => [cycle.cycleId, cycle])).values()]
}

function observeProductionState(status) {
  if (status.processState === 'idle' || status.operatorState === 'idle' || status.awaitingReset) return 'idle'
  if (status.processState === 'running' || status.processState === 'in_progress' || status.activeCycle) return 'running'
  return null
}

function resolveOperatingState(status) {
  if (status.processState === 'running') return { label: 'RUNNING', tone: 'green', known: true }
  if (status.processState === 'idle') return { label: 'IDLE', tone: 'red', known: true }
  if (status.processState === 'in_progress' || status.activeCycle) return { label: 'RUNNING', tone: 'green', known: true }
  if (status.processState === 'completed' || status.awaitingReset) return { label: 'IDLE', tone: 'red', known: true }
  return { label: 'IDLE', tone: 'gray', known: false }
}

export function ProductionProvider({ children }) {
  const [status, setStatus] = useState(EMPTY_STATUS)
  const [cycles, setCycles] = useState([])
  const [service, setService] = useState({ backend: false, detection: false, health: null })
  const [lastUpdate, setLastUpdate] = useState(null)
  const [connection, setConnection] = useState('connecting')
  const [clock, setClock] = useState(new Date())
  const [stageMetrics, setStageMetrics] = useState(() => readStageMetrics())
  const [alerts, setAlerts] = useState(() => readAlerts())
  const [idleTracking, setIdleTracking] = useState(() => readIdleTracking())
  const stageMetricsRef = useRef(stageMetrics)
  const idleRef = useRef(idleTracking)
  const alertIdsRef = useRef(new Set(alerts.map(alert => alert.id)))
  const loadRef = useRef(null)

  const recordAlert = useCallback(alert => {
    if (alertIdsRef.current.has(alert.id)) return
    const next = addAlert({ station: STATION, ...alert })
    alertIdsRef.current = new Set(next.map(item => item.id))
    setAlerts(next)
  }, [])

  const ingestHistory = useCallback(rows => {
    const result = ingestCompletedCycles(stageMetricsRef.current, rows)
    if (result.changed) {
      stageMetricsRef.current = result.metrics
      setStageMetrics(result.metrics)
    }
  }, [])

  const loadCore = useCallback(async () => {
    try {
      const [statusResponse, history, backendResponse, detectionResponse] = await Promise.all([
        fetch(`${API}/api/monitoring/status`),
        fetchCycleHistory(),
        fetch(`${API}/health`),
        fetch(`${DETECTION}/health`),
      ])
      if (statusResponse.ok) {
        const next = await statusResponse.json()
        setStatus(next)
        if (next.updatedAt) setLastUpdate(next.updatedAt)
      }
      ingestHistory(history)
      setCycles(current => {
        const merged = new Map(history.map(cycle => [cycle.cycleId, cycle]))
        current.forEach(cycle => { if (cycle.cycleId) merged.set(cycle.cycleId, cycle) })
        return [...merged.values()].sort((left, right) => Date.parse(right.completedAt || right.startedAt || 0) - Date.parse(left.completedAt || left.startedAt || 0))
      })
      setService(current => ({ ...current, backend: backendResponse.ok }))
      if (detectionResponse.ok) {
        const health = await detectionResponse.json()
        setService(current => ({ ...current, detection: Boolean(health.running), health }))
      } else {
        setService(current => ({ ...current, detection: false }))
      }
    } catch {
      setService(current => ({ ...current, backend: false }))
    }
  }, [ingestHistory])

  useEffect(() => { loadRef.current = loadCore }, [loadCore])
  useEffect(() => { let active = true; Promise.resolve().then(() => active && loadCore()); return () => { active = false } }, [loadCore])
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(timer) }, [])

  useEffect(() => {
    let alive = true
    let started = false
    const hub = new HubConnectionBuilder().withUrl(SIGNALR).withAutomaticReconnect().configureLogging(LogLevel.Error).build()
    const onStatus = value => {
      if (!alive) return
      setStatus(value)
      setLastUpdate(value.updatedAt || new Date().toISOString())
    }
    const onCycle = cycle => {
      if (!alive) return
      ingestHistory([cycle])
      setCycles(current => [cycle, ...current.filter(item => item.cycleId !== cycle.cycleId)])
      setStatus(current => ({ ...current, state: 'completed', processState: 'completed', currentStage: 'stage2', updatedAt: cycle.completedAt, activeCycle: null, lastCompletedCycle: cycle }))
      if (cycle.completedAt) setLastUpdate(cycle.completedAt)
    }
    hub.on('StatusUpdated', onStatus)
    hub.on('CycleCompleted', onCycle)
    hub.onreconnecting(() => alive && setConnection('reconnecting'))
    hub.onreconnected(async () => { if (alive) { setConnection('connected'); await loadRef.current?.() } })
    hub.start().then(async () => {
      started = true
      if (!alive) { await hub.stop(); return }
      setConnection('connected')
    }).catch(() => alive && setConnection('disconnected'))
    return () => { alive = false; hub.off('StatusUpdated', onStatus); hub.off('CycleCompleted', onCycle); if (started) hub.stop() }
  }, [ingestHistory])

  useEffect(() => {
    if (!status.updatedAt) return
    const observed = observeProductionState(status)
    if (!observed) return
    const previous = idleRef.current
    if (previous.lastKnownState === observed) {
      if (observed === 'idle' && previous.active?.startedAt && !alertIdsRef.current.has(`idle:${previous.active.startedAt}`)) {
        recordAlert({ id: `idle:${previous.active.startedAt}`, type: 'idle', severity: 'critical', title: status.operatorState === 'idle' ? 'Operator idle detected' : 'Production idle detected', occurredAt: previous.active.startedAt })
      }
      return
    }
    const at = new Date(status.updatedAt)
    if (!Number.isFinite(at.getTime())) return
    const atIso = at.toISOString()
    const intervals = [...previous.intervals]
    if (previous.lastKnownState === 'idle' && previous.active) {
      intervals.push({ startedAt: previous.active.startedAt, endedAt: new Date(Math.max(Date.parse(previous.active.startedAt), at.getTime())).toISOString() })
    }
    const next = writeIdleTracking({ version: 1, lastKnownState: observed, stateStartedAt: atIso, stateStartIsObserved: !previous.lastKnownState, active: observed === 'idle' ? { startedAt: atIso } : null, intervals })
    idleRef.current = next
    setIdleTracking(next)
    if (observed === 'idle') recordAlert({ id: `idle:${atIso}`, type: 'idle', severity: 'critical', title: status.operatorState === 'idle' ? 'Operator idle detected' : 'Production idle detected', occurredAt: atIso })
  }, [status, recordAlert])

  useEffect(() => {
    const byId = new Map([...cycles, status.activeCycle, status.lastCompletedCycle].filter(cycle => cycle?.cycleId).map(cycle => [cycle.cycleId, cycle]))
    const ordered = [...byId.values()].sort((left, right) => Date.parse(left.completedAt || left.startedAt || 0) - Date.parse(right.completedAt || right.startedAt || 0))
    for (const cycle of ordered) {
      for (const event of cycle.stageTimeline || []) {
        if (STAGES.includes(event.stage) && event.enteredAt) recordAlert({ id: `stage:${cycle.cycleId}:${event.stage}`, type: 'stage', severity: 'success', title: `${STAGE_LABELS[event.stage]} started`, occurredAt: event.enteredAt })
      }
      if (cycle.status === 'completed' && cycle.completedAt) {
        recordAlert({ id: `stage:${cycle.cycleId}:stage2:completed`, type: 'complete', severity: 'success', title: 'Stage 2 completed', occurredAt: cycle.completedAt })
        recordAlert({ id: `cycle:${cycle.cycleId}:completed`, type: 'complete', severity: 'success', title: 'Cycle completed', occurredAt: cycle.completedAt })
      }
    }
  }, [cycles, status.activeCycle, status.lastCompletedCycle, recordAlert])

  const value = useMemo(() => {
    const operating = resolveOperatingState(status)
    const detectionFailure = Boolean(service.health?.error && service.health.error !== 'Video sequence finished')
    return {
      status, cycles, service, lastUpdate, connection, clock, stageMetrics, alerts, idleTracking,
      operating, detectionFailure, station: STATION,
      serviceIssue: !service.backend || !service.detection || connection === 'disconnected',
      streamError: service.health?.error || (!service.detection ? 'Detection service is unavailable. Check the service health endpoint.' : null),
      refresh: loadCore,
      setCycles,
      setStatus,
      setService,
      recordAlert,
    }
  }, [status, cycles, service, lastUpdate, connection, clock, stageMetrics, alerts, idleTracking, loadCore, recordAlert])

  return <ProductionContext.Provider value={value}>{children}</ProductionContext.Provider>
}


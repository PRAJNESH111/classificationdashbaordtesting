export const STAGES = ['stage0', 'stage1', 'stage2']
const METRICS_KEY = 'foldwise.stageMetrics.v1'
const ALERTS_KEY = 'foldwise.productionAlerts.v1'
const IDLE_KEY = 'foldwise.idleIntervals.v1'
const MAX_CYCLE_IDS = 5000
const MAX_ALERTS = 100
const MAX_IDLE_INTERVALS = 1000

function readJson(key, fallback) {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}

function emptyBucket() {
  return Object.fromEntries(STAGES.map(stage => [stage, { count: 0, totalSeconds: 0, lastUpdatedAt: null }]))
}

export function readStageMetrics() {
  const raw = readJson(METRICS_KEY, null)
  if (!raw || raw.version !== 1 || !Array.isArray(raw.processedCycleIds) || !raw.overall || !raw.videos) {
    return { version: 1, processedCycleIds: [], processedThroughAt: null, processedThroughCycleId: null, overall: emptyBucket(), videos: {} }
  }
  const normalize = bucket => Object.fromEntries(STAGES.map(stage => {
    const entry = bucket?.[stage]
    const count = Number.isInteger(entry?.count) && entry.count > 0 ? entry.count : 0
    const totalSeconds = Number.isFinite(entry?.totalSeconds) && entry.totalSeconds > 0 ? entry.totalSeconds : 0
    return [stage, { count, totalSeconds, lastUpdatedAt: typeof entry?.lastUpdatedAt === 'string' ? entry.lastUpdatedAt : null }]
  }))
  const videos = {}
  for (const [video, bucket] of Object.entries(raw.videos)) videos[video] = normalize(bucket)
  return {
    version: 1,
    processedCycleIds: raw.processedCycleIds.filter(id => typeof id === 'string').slice(-MAX_CYCLE_IDS),
    processedThroughAt: Number.isFinite(Date.parse(raw.processedThroughAt)) ? raw.processedThroughAt : null,
    processedThroughCycleId: typeof raw.processedThroughCycleId === 'string' ? raw.processedThroughCycleId : null,
    overall: normalize(raw.overall),
    videos,
  }
}

export function stageDurationsForCycle(cycle) {
  const result = {}
  for (const stage of STAGES) {
    const seconds = Number(cycle?.stageDurationsSeconds?.[stage])
    if (Number.isFinite(seconds) && seconds > 0) result[stage] = seconds
  }
  const timeline = cycle?.stageTimeline || []
  const timestampDuration = (startStage, endStage, endFallback) => {
    const start = timeline.find(event => event.stage === startStage)?.enteredAt
    const end = timeline.find(event => event.stage === endStage)?.enteredAt || cycle?.[endFallback]
    const seconds = (Date.parse(end) - Date.parse(start)) / 1000
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null
  }
  if (!result.stage0) { const value = timestampDuration('stage0', 'stage1'); if (value) result.stage0 = value }
  if (!result.stage1) { const value = timestampDuration('stage1', 'stage2'); if (value) result.stage1 = value }
  if (!result.stage2) { const value = timestampDuration('stage2', null, 'completedAt'); if (value) result.stage2 = value }
  return result
}

export function ingestCompletedCycles(store, cycles) {
  // The bounded ID set handles normal duplicate delivery; the chronological cursor prevents old history from being re-added after IDs roll off.
  const next = structuredClone(store)
  const known = new Set(next.processedCycleIds)
  let changed = false
  const orderedCycles = [...(cycles || [])].sort((left, right) => Date.parse(left?.completedAt || 0) - Date.parse(right?.completedAt || 0) || String(left?.cycleId || '').localeCompare(String(right?.cycleId || '')))
  for (const cycle of orderedCycles) {
    const cycleId = typeof cycle?.cycleId === 'string' ? cycle.cycleId : ''
    if (!cycleId || known.has(cycleId) || cycle.status && cycle.status !== 'completed') continue
    const completedAt = cycle.completedAt
    const completedTime = Date.parse(completedAt)
    if (!Number.isFinite(completedTime)) continue
    const cursorTime = Date.parse(next.processedThroughAt || '')
    if (Number.isFinite(cursorTime) && (completedTime < cursorTime || (completedTime === cursorTime && cycleId.localeCompare(next.processedThroughCycleId || '') <= 0))) continue
    const samples = stageDurationsForCycle(cycle)
    if (!Object.keys(samples).length) continue
    const at = completedAt
    const add = bucket => {
      for (const [stage, seconds] of Object.entries(samples)) {
        const entry = bucket[stage]
        entry.count += 1
        entry.totalSeconds += seconds
        entry.lastUpdatedAt = at
      }
    }
    add(next.overall)
    if (cycle.sourceVideo) {
      if (!next.videos[cycle.sourceVideo]) next.videos[cycle.sourceVideo] = emptyBucket()
      add(next.videos[cycle.sourceVideo])
    }
    known.add(cycleId)
    next.processedCycleIds.push(cycleId)
    next.processedThroughAt = completedAt
    next.processedThroughCycleId = cycleId
    changed = true
  }
  if (next.processedCycleIds.length > MAX_CYCLE_IDS) next.processedCycleIds = next.processedCycleIds.slice(-MAX_CYCLE_IDS)
  if (changed) writeJson(METRICS_KEY, next)
  return { metrics: next, changed }
}

export function stageTarget(metrics, sourceVideo, stage) {
  // Prefer the selected video's historical mean; use the all-video mean only as a fallback.
  const videoEntry = sourceVideo ? metrics.videos?.[sourceVideo]?.[stage] : null
  if (videoEntry?.count > 0 && Number.isFinite(videoEntry.totalSeconds / videoEntry.count)) {
    return { seconds: videoEntry.totalSeconds / videoEntry.count, count: videoEntry.count, source: 'video' }
  }
  const overall = metrics.overall?.[stage]
  if (overall?.count > 0 && Number.isFinite(overall.totalSeconds / overall.count)) {
    return { seconds: overall.totalSeconds / overall.count, count: overall.count, source: 'overall' }
  }
  return null
}

export function calculateStageElapsedSeconds(cycle, updatedAt, nowMs) {
  if (!cycle) return null
  const trackerElapsed = Number(cycle.stageElapsedSeconds)
  const updateTime = Date.parse(updatedAt || '')
  if (Number.isFinite(trackerElapsed) && Number.isFinite(updateTime)) {
    return Math.max(0, trackerElapsed + Math.max(0, (nowMs - updateTime) / 1000))
  }
  const enteredAt = cycle.stageTimeline?.find(event => event.stage === cycle.currentStage)?.enteredAt
  const enteredTime = Date.parse(enteredAt || '')
  return Number.isFinite(enteredTime) ? Math.max(0, (nowMs - enteredTime) / 1000) : Number.isFinite(trackerElapsed) ? Math.max(0, trackerElapsed) : null
}

export function calculateRemainingEstimate(cycle, metrics, sourceVideo, elapsedSeconds) {
  if (!cycle || elapsedSeconds == null) return null
  const currentIndex = STAGES.indexOf(cycle.currentStage)
  if (currentIndex < 0) return null
  const targets = STAGES.slice(currentIndex).map(stage => stageTarget(metrics, sourceVideo || cycle.sourceVideo, stage))
  if (targets.some(target => !target)) return null
  return targets.reduce((sum, target, offset) => sum + (offset === 0 ? Math.max(0, target.seconds - elapsedSeconds) : target.seconds), 0)
}

export function calculateStageOverrun(target, elapsedSeconds) {
  return target && elapsedSeconds != null ? elapsedSeconds - target.seconds : null
}

export function calculateStageProgress(target, elapsedSeconds) {
  return target && elapsedSeconds != null && target.seconds > 0
    ? Math.min(100, Math.max(0, elapsedSeconds / target.seconds * 100))
    : null
}

export function averageStageVariance(cycles, metrics) {
  const samples = []
  for (const cycle of cycles || []) {
    const durations = stageDurationsForCycle(cycle)
    for (const stage of STAGES) {
      const target = stageTarget(metrics, cycle.sourceVideo, stage)
      const observed = durations[stage]
      if (target && Number.isFinite(observed) && target.seconds > 0) samples.push((observed - target.seconds) / target.seconds * 100)
    }
  }
  return samples.length ? samples.reduce((sum, sample) => sum + sample, 0) / samples.length : null
}

export function readAlerts() {
  const raw = readJson(ALERTS_KEY, null)
  return raw?.version === 1 && Array.isArray(raw.events)
    ? raw.events.filter(event => event && typeof event.id === 'string' && typeof event.title === 'string' && Number.isFinite(Date.parse(event.occurredAt)) && ['critical', 'warning', 'success'].includes(event.severity)).slice(0, MAX_ALERTS)
    : []
}

export function addAlert(alert) {
  const current = readAlerts()
  if (current.some(event => event.id === alert.id)) return current
  const events = [alert, ...current].slice(0, MAX_ALERTS)
  writeJson(ALERTS_KEY, { version: 1, events })
  return events
}

export function readIdleTracking() {
  const raw = readJson(IDLE_KEY, null)
  return raw?.version === 1 && Array.isArray(raw.intervals)
    ? {
      version: 1,
      lastKnownState: ['idle', 'running'].includes(raw.lastKnownState) ? raw.lastKnownState : null,
      stateStartedAt: Number.isFinite(Date.parse(raw.stateStartedAt)) ? raw.stateStartedAt : null,
      stateStartIsObserved: Boolean(raw.stateStartIsObserved),
      active: raw.active && Number.isFinite(Date.parse(raw.active.startedAt)) ? raw.active : null,
      intervals: raw.intervals.filter(item => Number.isFinite(Date.parse(item?.startedAt)) && Number.isFinite(Date.parse(item?.endedAt))).slice(-MAX_IDLE_INTERVALS),
    }
    : { version: 1, lastKnownState: null, stateStartedAt: null, stateStartIsObserved: false, active: null, intervals: [] }
}

export function writeIdleTracking(tracking) {
  const safe = { ...tracking, intervals: (tracking.intervals || []).slice(-MAX_IDLE_INTERVALS) }
  writeJson(IDLE_KEY, safe)
  return safe
}

export function secondsForLocalDay(interval, date) {
  const start = Date.parse(interval.startedAt)
  const end = Date.parse(interval.endedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
  return Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart)) / 1000
}


export const STAGE_LABELS = { stage0: 'Stage 0', stage1: 'Stage 1', stage2: 'Stage 2' }

export function duration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const total = Math.max(0, Math.floor(Number(seconds)))
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}

export function shortDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`
  const minutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes} min`
}

export function formatTimestamp(value) { return value ? new Date(value).toLocaleString() : '—' }

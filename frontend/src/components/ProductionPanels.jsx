import { memo } from 'react'
import { STAGES } from '../utils/productionMetrics'
import { duration, formatTimestamp, shortDuration, STAGE_LABELS } from '../utils/productionFormatters'

export function Panel({ title, subtitle, action, children, className = '', compact = false }) {
  return <section className={`overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
    {(title || action) && <header className={`flex items-center justify-between border-b border-slate-100 ${compact ? 'min-h-9 gap-2 px-3 py-1.5' : 'min-h-16 gap-4 px-5 py-3 sm:px-6'}`}>
      <div className="min-w-0"><h2 className={`${compact ? 'text-xs' : 'text-sm'} font-bold tracking-wide text-slate-800`}>{title}</h2>{subtitle && !compact && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div>
      {action}
    </header>}
    {children}
  </section>
}

export function SummaryCard({ label, value, detail, icon, tone = 'slate', compact = false }) {
  const accents = { green: 'border-t-emerald-600', blue: 'border-t-blue-600', amber: 'border-t-amber-500', indigo: 'border-t-indigo-500', red: 'border-t-red-500', slate: 'border-t-slate-300' }
  const valueColors = { green: 'text-emerald-900', blue: 'text-blue-900', amber: 'text-amber-900', indigo: 'text-indigo-900', red: 'text-red-800', slate: 'text-slate-800' }
  return <article className={`min-w-0 rounded-lg border border-slate-200 border-t-[3px] ${accents[tone]} bg-white ${compact ? 'p-2' : 'p-4 sm:p-5'} shadow-sm`}>
    <div className="flex items-center justify-between gap-2"><p className="truncate text-[10px] font-medium text-slate-500">{label}</p><span className={`grid shrink-0 place-items-center rounded-md bg-slate-50 text-slate-500 ${compact ? 'size-5 text-[10px]' : 'size-8 text-sm'}`}>{icon}</span></div>
    <p className={`mt-0.5 truncate font-bold tracking-tight ${compact ? 'text-base' : 'text-xl sm:text-2xl'} ${valueColors[tone]}`}>{value}</p>
    <p className="min-h-3 truncate text-[10px] text-slate-500">{detail}</p>
  </article>
}

export function ProcessTimeline({ status, operating, clock, elapsedSeconds, target, overrunSeconds, progress, compact = false }) {
  const cycle = status.activeCycle
  const timelineCycle = cycle || status.lastCompletedCycle
  const events = timelineCycle?.stageTimeline || []
  const currentIndex = STAGES.indexOf(cycle?.currentStage || status.currentStage)
  const currentStartedAt = cycle?.stageTimeline?.find(event => event.stage === cycle.currentStage)?.enteredAt
  const idle = operating.known && operating.label === 'IDLE'

  return <Panel compact={compact} title="BAY 1 — BOX FOLDING"  className={`min-h-0 ${compact ? 'xl:overflow-hidden' : ''} border-t-4 ${idle ? 'border-t-red-500' : operating.tone === 'green' ? 'border-t-emerald-600' : 'border-t-slate-300'}`} action={<div className="flex items-center gap-3"><StatusPill tone={operating.tone}>{operating.label}</StatusPill>{status.updatedAt && <span className="hidden text-xs text-slate-500 sm:inline">Updated {Math.max(0, Math.floor((clock.getTime() - new Date(status.updatedAt).getTime()) / 1000))}s ago</span>}</div>}>
    <div className={compact ? 'space-y-1.5 p-2' : 'space-y-3 p-4 sm:p-5'}>
      <div aria-live="polite" className={`flex min-h-6 items-center rounded-md border px-2 py-1 text-[10px] ${status.awaitingReset ? 'border-amber-200 bg-amber-50 font-medium text-amber-900' : idle && status.operatorState === 'idle' ? 'border-red-200 bg-red-50 font-medium text-red-800' : 'invisible border-transparent'}`}>
        {status.awaitingReset ? 'Cycle complete · waiting for work-area reset' : idle && status.operatorState === 'idle' ? 'No active hand movement detected.' : 'No current operating notice'}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label={`Process stages, current state ${operating.label}`}>
        {STAGES.map((stage, index) => {
          const event = events.find(item => item.stage === stage)
          const state = !cycle ? 'WAITING' : index < currentIndex ? 'COMPLETED' : index === currentIndex ? 'ACTIVE' : 'WAITING'
          const stageIdle = Boolean(cycle && idle && status.operatorState === 'idle' && index === currentIndex)
          const actualElapsed = cycle ? (index === currentIndex ? elapsedSeconds : cycle.stageDurationsSeconds?.[stage]) : timelineCycle?.stageDurationsSeconds?.[stage]
          const frameTone = stageIdle ? 'border-red-200 bg-red-50' : state === 'COMPLETED' ? 'border-emerald-200 bg-emerald-50' : state === 'ACTIVE' && overrunSeconds > 0 ? 'border-red-200 bg-red-50' : state === 'ACTIVE' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'
          const markerTone = stageIdle ? 'bg-red-100 text-red-800 ring-red-200' : state === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800 ring-emerald-200' : state === 'ACTIVE' && overrunSeconds > 0 ? 'bg-red-500 text-white ring-red-200' : state === 'ACTIVE' ? 'bg-amber-400 text-amber-950 ring-amber-200' : 'bg-white text-slate-500 ring-slate-200'
          const stateTone = stageIdle ? 'text-red-700' : state === 'COMPLETED' ? 'text-emerald-700' : state === 'ACTIVE' && overrunSeconds > 0 ? 'text-red-700' : state === 'ACTIVE' ? 'text-amber-800' : 'text-slate-400'
          return <article key={stage} className={`relative ${compact ? 'min-h-0 p-1.5' : 'min-h-32 p-3 sm:p-4'} rounded-lg border ${frameTone}`}>
            <div className="flex items-center justify-between gap-2"><span className={`grid shrink-0 place-items-center rounded-full text-xs font-bold ring-2 ${compact ? 'size-5' : 'size-8 text-sm'} ${markerTone}`}>{index + 1}</span><span className={`text-[9px] font-bold tracking-widest ${stateTone}`}>{state}</span></div>
            <h3 className={`${compact ? 'mt-0.5 text-[11px]' : 'mt-3 text-sm'} font-bold text-slate-800`}>{STAGE_LABELS[stage]}</h3>
            <p className={`${compact ? 'text-[9px]' : 'text-[11px]'} truncate text-slate-500`}>{event ? `${cycle ? '' : 'Last: '}${new Date(event.enteredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No stage time recorded'}</p>
            {actualElapsed != null && <p className="text-[10px] font-medium text-slate-600">{cycle && state === 'ACTIVE' ? `Elapsed ${duration(actualElapsed)}` : `${cycle ? '' : 'Last: '}${duration(actualElapsed)}`}</p>}
          </article>
        })}
      </div>

      <div className={`grid grid-cols-2 ${compact ? 'gap-2' : 'gap-3'} lg:grid-cols-4`}>
        <StageDetail compact={compact} label="STEP STARTED" value={currentStartedAt ? new Date(currentStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}/>
        <StageDetail compact={compact} label="TARGET STAGE" value={target ? `${shortDuration(target.seconds)} · ${target.source === 'video' ? 'video' : 'overall'}` : 'Learning baseline'}/>
        <StageDetail compact={compact} label="OVERRUN" value={overrunSeconds == null ? '—' : overrunSeconds > 0 ? `+${shortDuration(overrunSeconds)}` : 'Within target'} tone={overrunSeconds > 0 ? 'red' : 'slate'}/>
        <div className={`flex min-w-0 flex-col justify-center rounded-lg bg-slate-100 px-3 ${compact ? 'gap-1 py-1.5' : 'gap-2 py-2.5'}`}>
          <div className="flex justify-between gap-2 text-[10px] font-semibold text-slate-500"><span>STAGE PROGRESS</span><b className="text-slate-700">{progress == null ? 'Learning baseline' : `${Math.round(progress)}%`}</b></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full transition-[width] duration-300 ${overrunSeconds > 0 ? 'bg-red-500' : 'bg-amber-400'}`} style={{ width: `${progress ?? 0}%` }}/></div>
        </div>
      </div>
      {!compact && cycle && <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500"><span>Cycle started <b className="ml-1 text-slate-700">{new Date(cycle.startedAt).toLocaleString()}</b></span><span>Elapsed <b className="ml-1 text-slate-700">{duration(cycle.elapsedSeconds)}</b></span></div>}
      {!compact && !cycle && status.lastCompletedCycle && <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">Last completed cycle <b className="ml-1 text-slate-700">{new Date(status.lastCompletedCycle.completedAt).toLocaleString()}</b></p>}
    </div>
  </Panel>
}

function StageDetail({ label, value, tone = 'slate', compact = false }) {
  const colors = tone === 'red' ? 'text-red-800' : 'text-slate-800'
  return <div className={`flex min-w-0 flex-col justify-center gap-0.5 rounded-lg bg-slate-100 px-2 ${compact ? 'py-1' : 'py-2.5'}`}><span className="text-[9px] font-semibold text-slate-500">{label}</span><b className={`truncate ${compact ? 'text-[11px]' : 'text-sm'} ${colors}`}>{value}</b></div>
}

export function StatusPill({ tone = 'slate', children, compact = false }) {
  const colors = { green: 'border-emerald-200 bg-emerald-50 text-emerald-800', red: 'border-red-200 bg-red-50 text-red-800', amber: 'border-amber-200 bg-amber-50 text-amber-800', gray: 'border-slate-200 bg-slate-50 text-slate-600', slate: 'border-slate-200 bg-slate-50 text-slate-700' }
  const dot = { green: 'bg-emerald-500', red: 'bg-red-500', amber: 'bg-amber-500', gray: 'bg-slate-400', slate: 'bg-slate-400' }
  return <span className={`inline-flex items-center gap-1.5 rounded-full border font-bold tracking-wider ${compact ? 'px-2 py-1 text-[9px]' : 'px-3 py-1.5 text-[10px]'} ${colors[tone] || colors.slate}`}><i className={`size-2 rounded-full ${dot[tone] || dot.slate}`}/>{children}</span>
}

export function ActiveAlerts({ alerts, station, compact = false, operating }) {
  const orderedAlerts = [...alerts].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
  if (operating && !operating.known) orderedAlerts.unshift({ id: 'process-status-pending', severity: 'warning', title: 'Process status pending', isStatusPending: true })
  const recent = orderedAlerts.slice(0, compact ? 3 : 6)
  const tones = { critical: 'border-red-200 bg-red-50 text-red-900', warning: 'border-amber-200 bg-amber-50 text-amber-950', success: 'border-emerald-200 bg-emerald-50 text-emerald-950' }
  const icons = { critical: '!', warning: '◷', success: '✓' }
  return <Panel compact={compact} className={compact ? 'min-h-0' : ''} title="ACTIVE ALERTS" subtitle="Recent confirmed station events">
    <div className={`space-y-1 ${compact ? 'p-2' : 'space-y-2 p-4'}`}>{recent.length ? recent.map(alert => <article key={alert.id} className={`flex items-center gap-2 rounded-md border ${compact ? 'px-2 py-1' : 'gap-3 p-3'} ${tones[alert.severity] || tones.success}`}>
      <span className={`grid shrink-0 place-items-center rounded-md bg-white/70 font-bold ${compact ? 'size-6 text-xs' : 'size-8 text-sm'}`}>{icons[alert.severity] || '•'}</span>
      <div className="min-w-0"><p className="truncate text-xs font-bold">{alert.title}</p><p className="mt-0.5 text-[10px] opacity-70">{alert.isStatusPending ? 'Waiting for a confirmed process update' : new Date(alert.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {alert.station || station}</p></div>
    </article>) : <p className="p-8 text-center text-xs text-slate-500">No production events recorded yet.</p>}</div>
  </Panel>
}

export function BayDailySummary({ completed, cyclesStarted, idleSeconds, variance, inProgress, compact = false }) {
  const rows = [
    ['Completed cycles', `${completed}${inProgress ? ` (${inProgress} in progress)` : ''}`],
    ['Cycles started today', cyclesStarted],
    ['Idle time flagged · local', shortDuration(idleSeconds)],
    ['Average stage variance', variance == null ? 'Learning baseline' : `${variance > 0 ? '+' : ''}${Math.round(variance)}%`],
  ]
  return <Panel compact={compact} className={compact ? 'min-h-0' : ''} title="TODAY ON THIS BAY" subtitle="Local calendar day · tracked in this browser">
    <dl className={`divide-y divide-slate-100 ${compact ? 'px-3' : 'px-5 py-1'}`}>{rows.map(([label, value], index) => <div key={label} className={`flex items-center justify-between gap-4 text-xs ${compact ? 'min-h-9 py-1' : 'min-h-11 py-2'}`}>
      <dt className="text-slate-500" title={index === 3 ? 'Mean variance: (observed duration − historical target) / historical target × 100' : undefined}>{label}</dt>
      <dd className={`text-right font-bold ${index === 3 && variance != null ? variance > 0 ? 'text-red-700' : 'text-emerald-700' : 'text-slate-800'}`}>{value}</dd>
    </div>)}</dl>
  </Panel>
}

export const LiveProcessFeed = memo(function LiveProcessFeed({ available, error, sourceName, station, onError, className = '' }) { return <Panel title="Live process feed"  className={className} action={<span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold tracking-widest ${available ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}><i className={`size-2 rounded-full ${available ? 'bg-emerald-500' : 'bg-red-500'}`}/>{available ? 'LIVE' : 'OFFLINE'}</span>}>
  <div className="relative min-h-64 flex-1 overflow-hidden bg-slate-950 sm:min-h-0">
    {available ? <img src={import.meta.env.VITE_VIDEO_URL || 'http://localhost:8000/video'} alt="Live annotated box folding process feed" onError={onError} className="absolute inset-0 h-full w-full object-contain"/> : <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center text-white"><span className="mb-3 grid size-10 place-items-center rounded-full border border-red-400/50 text-red-300">!</span><b className="text-sm">Video feed unavailable</b><p className="mt-2 max-w-md text-xs leading-5 text-slate-300">{error || 'Check the detection service connection.'}</p></div>}
    <div className="absolute inset-x-0 bottom-0 flex min-h-10 items-center justify-between gap-3 bg-slate-900/95 px-4 text-[10px] font-semibold tracking-wider text-slate-200"><span>{station}</span><span className="truncate text-slate-400">{sourceName || 'SOURCE UNAVAILABLE'}</span></div>
  </div>
</Panel> })

export function CycleTable({ rows, className = '' }) {
  return <div className={`max-w-full overflow-auto ${className}`}><table className="w-full min-w-[850px] border-collapse text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[10px] font-bold tracking-wider text-slate-500"><tr>{['CYCLE ID', 'VIDEO', 'STARTED AT', 'STAGE TIMELINE · ENTERED AT', 'COMPLETED AT', 'TOTAL TIME'].map(label => <th key={label} className="border-y border-slate-200 px-4 py-3">{label}</th>)}</tr></thead><tbody>{rows.length ? rows.map(cycle => <tr key={cycle.cycleId} className="border-b border-slate-100 text-slate-600 hover:bg-slate-50"><td className="px-4 py-3 font-mono font-semibold text-emerald-800">{cycle.cycleId?.slice(0, 8) || '—'}</td><td className="px-4 py-3">{cycle.sourceVideo || '—'}</td><td className="px-4 py-3">{formatTimestamp(cycle.startedAt)}</td><td className="px-4 py-3"><div className="flex gap-3">{STAGES.map(stage => <span key={stage} className="grid gap-1"><b className="text-[10px] text-slate-700">{STAGE_LABELS[stage]}</b><small className="text-slate-500">{formatTimestamp(cycle.stageTimeline?.find(event => event.stage === stage)?.enteredAt)}</small></span>)}</div></td><td className="px-4 py-3">{formatTimestamp(cycle.completedAt)}</td><td className="px-4 py-3">{duration(cycle.durationSeconds)}</td></tr>) : <tr><td colSpan="6" className="p-10 text-center text-slate-500">No completed cycles have been received yet.</td></tr>}</tbody></table></div>
}

export function MetricGridCard({ label, value, detail }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-4 py-3"><p className="text-[10px] font-bold tracking-wider text-slate-500">{label}</p><b className="mt-1 block text-xl text-slate-800">{value}</b><small className="mt-1 block text-xs text-slate-500">{detail}</small></div>
}

import { useMemo } from 'react'
import { useProduction } from '../context/useProduction'
import { ActiveAlerts, BayDailySummary, ProcessTimeline, SummaryCard } from '../components/ProductionPanels'
import { STAGES, averageStageVariance, calculateRemainingEstimate, calculateStageElapsedSeconds, calculateStageOverrun, calculateStageProgress, secondsForLocalDay, stageTarget } from '../utils/productionMetrics'
import { shortDuration } from '../utils/productionFormatters'

function sameLocalDay(value, date) { return value && new Date(value).toDateString() === date.toDateString() }

export default function LiveFloorPage() {
  const { status, cycles, stageMetrics, alerts, idleTracking, operating, clock, station } = useProduction()
  const activeCycle = status.activeCycle
  const activeStage = activeCycle?.currentStage
  const stageIndex = STAGES.indexOf(activeStage)
  const target = activeStage ? stageTarget(stageMetrics, activeStage) : null
  const elapsed = calculateStageElapsedSeconds(activeCycle, status.updatedAt, clock.getTime())
  const estimate = calculateRemainingEstimate(activeCycle, stageMetrics, elapsed)
  const overrun = calculateStageOverrun(target, elapsed)
  const progress = calculateStageProgress(target, elapsed)
  const completedToday = new Set(cycles.filter(cycle => cycle.cycleId && sameLocalDay(cycle.completedAt, clock)).map(cycle => cycle.cycleId)).size
  const cyclesStartedToday = useMemo(() => {
    const seen = new Set()
    for (const cycle of [...cycles, ...(activeCycle ? [activeCycle] : [])]) {
      if (cycle.cycleId && sameLocalDay(cycle.startedAt, clock)) seen.add(cycle.cycleId)
    }
    return seen.size
  }, [cycles, activeCycle, clock])
  const idleSeconds = useMemo(() => idleTracking.intervals.reduce((sum, interval) => sum + secondsForLocalDay(interval, clock), 0) + (idleTracking.active ? secondsForLocalDay({ ...idleTracking.active, endedAt: clock.toISOString() }, clock) : 0), [idleTracking, clock])
  const variance = useMemo(() => averageStageVariance(cycles, stageMetrics), [cycles, stageMetrics])
  const stateTime = idleTracking.lastKnownState === operating.label.toLowerCase() && idleTracking.stateStartedAt
    ? `${idleTracking.stateStartIsObserved ? 'Tracked since' : 'Since'} ${new Date(idleTracking.stateStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : operating.known ? 'State tracking started' : 'No status received'

  return <div className="mx-auto grid min-h-full w-full max-w-none grid-cols-1 content-start gap-2 xl:h-full xl:min-h-0 xl:grid-cols-2 xl:grid-rows-[auto_auto_minmax(0,1fr)_auto]">
    <div className="flex flex-wrap items-end justify-between gap-2 xl:col-span-2">
      <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">FLOOR SUPERVISOR</p><h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">Supervisor — live floor view</h2><p className="mt-0.5 text-xs text-slate-500">Operational detail for one bay · the level a supervisor acts on.</p></div>
      <span className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Bay 1 · Box folding</span>
    </div>
    <section aria-label="Bay 1 summary" className="grid grid-cols-2 gap-2 xl:col-span-2 xl:grid-cols-4">
      <SummaryCard compact label="BAY 1 STATUS" value={!operating.known ? 'Folding not started' : operating.label === 'RUNNING' ? 'Running' : 'Idle'} detail={stateTime} icon="◉" tone={operating.tone}/>
      <SummaryCard compact label="ACTIVE STAGE" value={activeStage ? `Stage ${stageIndex}` : 'Waiting for cycle'} detail={activeStage ? `Step ${stageIndex + 1} of 3` : status.awaitingReset ? 'Awaiting work-area reset' : 'No active cycle'} icon="▤" tone={activeStage ? operating.label === 'IDLE' || overrun > 0 ? 'red' : 'amber' : 'slate'}/>
      <SummaryCard compact label="TIME IN STAGE" value={elapsed != null ? `${Math.floor(elapsed / 60)}m ${String(Math.floor(elapsed % 60)).padStart(2, '0')}s` : '—'} detail={target ? `Historical target ${shortDuration(target.seconds)} · ${target.source === 'video' ? 'this video' : 'overall'}` : activeStage ? 'Learning baseline' : 'No active stage'} icon="◷" tone={overrun > 0 ? 'red' : 'amber'}/>
      <SummaryCard compact label="PREDICTED FINISH" value={estimate != null ? `~${shortDuration(estimate)}` : activeCycle ? 'Learning baseline' : 'Waiting for cycle'} detail={estimate != null ? `Est. ${new Date(clock.getTime() + estimate * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : activeCycle ? 'Historical stage data needed' : 'No cycle in progress'} icon="◷" tone="indigo"/>
    </section>

    <div className="min-w-0 xl:col-span-2">
      <ProcessTimeline compact status={status} operating={operating} clock={clock} elapsedSeconds={elapsed} target={target} overrunSeconds={overrun} progress={progress}/>
    </div>

    <section className="grid min-w-0 grid-cols-1 gap-2 xl:col-span-2 xl:grid-cols-2">
      <ActiveAlerts compact alerts={alerts} station={station} operating={operating}/>
      <BayDailySummary compact completed={completedToday} cyclesStarted={cyclesStartedToday} idleSeconds={idleSeconds} variance={variance} inProgress={activeCycle ? 1 : 0}/>
    </section>
  </div>
}

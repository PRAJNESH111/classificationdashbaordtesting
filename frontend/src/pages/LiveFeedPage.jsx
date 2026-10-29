import { useCallback } from 'react'
import { LiveProcessFeed, MetricGridCard, ProcessTimeline } from '../components/ProductionPanels'
import { useProduction } from '../context/useProduction'
import { STAGES, calculateRemainingEstimate, calculateStageElapsedSeconds, calculateStageOverrun, calculateStageProgress, stageTarget } from '../utils/productionMetrics'
import { shortDuration } from '../utils/productionFormatters'

export default function LiveFeedPage() {
  const { status, service, operating, clock, lastUpdate, station, streamError, setService, stageMetrics, connection } = useProduction()
  const activeCycle = status.activeCycle
  const activeStage = activeCycle?.currentStage
  const stageIndex = STAGES.indexOf(activeStage)
  const target = activeStage ? stageTarget(stageMetrics, status.videoName || activeCycle?.sourceVideo, activeStage) : null
  const elapsed = calculateStageElapsedSeconds(activeCycle, status.updatedAt, clock.getTime())
  const overrun = calculateStageOverrun(target, elapsed)
  const progress = calculateStageProgress(target, elapsed)
  const estimate = calculateRemainingEstimate(activeCycle, stageMetrics, status.videoName, elapsed)
  const onStreamError = useCallback(() => setService(current => ({ ...current, detection: false })), [setService])

  return <section className="flex h-full min-h-[32rem] flex-col gap-3">
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(360px,1fr)]">
      <LiveProcessFeed className="flex min-h-0 flex-col" available={service.detection} error={streamError} sourceName={status.videoName} station={station} onError={onStreamError}/>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <ProcessTimeline status={status} operating={operating} clock={clock} elapsedSeconds={elapsed} target={target} overrunSeconds={overrun} progress={progress}/>
        <div className="grid grid-cols-2 gap-3"><MetricGridCard label="ACTIVE STAGE" value={activeStage ? `Stage ${stageIndex}` : 'Waiting'} detail={activeStage ? `Step ${stageIndex + 1} of 3` : 'No active cycle'}/><MetricGridCard label="PREDICTED FINISH" value={estimate != null ? `~${shortDuration(estimate)}` : 'Learning baseline'} detail="Based on saved stage averages"/></div>
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-500"><span>SignalR <b className="ml-1 text-slate-800">{connection}</b></span><span>Source <b className="ml-1 text-slate-800">{status.videoName || 'Unavailable'}</b></span><span>Last update <b className="ml-1 text-slate-800">{lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'No update received'}</b></span></div>
  </section>
}

import { useCallback } from 'react'
import { LiveProcessFeed, MetricGridCard, ProcessTimeline } from '../components/ProductionPanels'
import { useProduction } from '../context/useProduction'
import { STAGES, calculateRemainingEstimate, calculateStageElapsedSeconds, calculateStageOverrun, calculateStageProgress, stageTarget } from '../utils/productionMetrics'
import { shortDuration } from '../utils/productionFormatters'

export default function LiveFeedPage({ showAllStages = false }) {
  const { status, service, operating, clock, station, streamError, setService, stageMetrics } = useProduction()
  const activeCycle = status.activeCycle
  const activeStage = activeCycle?.currentStage
  const stageIndex = STAGES.indexOf(activeStage)
  const target = activeStage ? stageTarget(stageMetrics, activeStage) : null
  const elapsed = calculateStageElapsedSeconds(activeCycle, status.updatedAt, clock.getTime())
  const overrun = calculateStageOverrun(target, elapsed)
  const progress = calculateStageProgress(target, elapsed)
  const estimate = calculateRemainingEstimate(activeCycle, stageMetrics, elapsed)
  const onStreamError = useCallback(() => setService(current => ({ ...current, detection: false })), [setService])

  return <section className="flex h-full min-h-[32rem] flex-col gap-3">
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(360px,1fr)]">
      <LiveProcessFeed className="flex min-h-0 flex-col" available={service.detection} error={streamError} sourceName={status.videoName} station={station} onError={onStreamError}/>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <ProcessTimeline status={status} operating={operating} clock={clock} elapsedSeconds={elapsed} target={target} overrunSeconds={overrun} progress={progress} horizontalStages showAllStages={showAllStages}/>
        <div className="grid grid-cols-2 gap-3"><MetricGridCard label="ACTIVE STAGE" value={activeStage ? `Stage ${stageIndex}` : 'Waiting'} detail={activeStage ? `Step ${stageIndex + 1} of 3` : 'No active cycle'}/><MetricGridCard label="PREDICTED FINISH" value={estimate != null ? `~${shortDuration(estimate)}` : 'Waiting'} /></div>
      </div>
    </div>
  </section>
}

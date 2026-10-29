import { useEffect, useMemo, useState } from 'react'
import { MetricGridCard, Panel, CycleTable } from '../components/ProductionPanels'
import { useProduction } from '../context/useProduction'
import { duration } from '../utils/productionFormatters'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const localDateInput = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function ReportsPage({ productionView = false }) {
  const { clock } = useProduction()
  const [fromDate, setFromDate] = useState(localDateInput)
  const [toDate, setToDate] = useState(localDateInput)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    let active = true
    Promise.resolve().then(async () => {
      try {
        const query = `from=${encodeURIComponent(`${fromDate}T00:00:00Z`)}&to=${encodeURIComponent(`${toDate}T23:59:59.999Z`)}`
        const response = await fetch(`${API}/api/reports/summary?${query}`)
        if (!response.ok) throw new Error(`Report request failed (${response.status})`)
        const value = await response.json()
        if (active) { setReport(value); setError('') }
      } catch (requestError) {
        if (active) setError(requestError.message || 'Could not load the report.')
      }
    })
    return () => { active = false }
  }, [fromDate, toDate, refreshVersion])

  const maxCount = useMemo(() => Math.max(1, ...(report?.hourly || []).map(item => item.count)), [report])
  const exportCsv = () => downloadCsv(report?.cycles || [])

  return <div className="flex min-h-full flex-col gap-3">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{productionView ? 'Production overview' : 'Production analytics'}</p><h2 className="mt-1 text-xl font-bold text-slate-900">{productionView ? 'Production Overview' : 'Reports'}</h2></div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><label className="flex items-center gap-2 text-xs text-slate-600">From <input className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)}/></label><label className="flex items-center gap-2 text-xs text-slate-600">To <input className="rounded-md border border-slate-300 px-2 py-1.5 text-xs" type="date" value={toDate} onChange={event => setToDate(event.target.value)}/></label><button type="button" onClick={() => setRefreshVersion(value => value + 1)} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Refresh</button><button type="button" onClick={exportCsv} className="rounded-md bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">Export CSV</button></div>
    </div>
    {error && <p role="status" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">{error}</p>}
    <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
      <MetricGridCard label="COMPLETED CYCLES" value={report?.completedCycles ?? 0} detail="Selected range"/>
      <MetricGridCard label="AVERAGE TIME" value={duration(report?.averageDurationSeconds)} detail="Completed cycles"/>
      <MetricGridCard label="FASTEST CYCLE" value={duration(report?.minimumDurationSeconds)} detail="Recorded minimum"/>
      <MetricGridCard label="SLOWEST CYCLE" value={duration(report?.maximumDurationSeconds)} detail="Recorded maximum"/>
      <MetricGridCard label="AVG STAGE 0" value={duration(report?.averageStageDurationsSeconds?.stage0)} detail="Historical mean"/>
      <MetricGridCard label="AVG STAGE 1" value={duration(report?.averageStageDurationsSeconds?.stage1)} detail="Historical mean"/>
      <MetricGridCard label="AVG STAGE 2" value={duration(report?.averageStageDurationsSeconds?.stage2)} detail="Historical mean"/>
    </div>
    <Panel className="shrink-0" title={productionView ? 'Hourly production' : 'Production report'} subtitle="Completed cycles by hour">
      <div className="flex h-44 items-end gap-3 overflow-x-auto px-5 py-4">{(report?.hourly || []).length ? report.hourly.map(item => <div key={item.hour} className="flex h-full min-w-10 flex-1 flex-col items-center justify-end gap-2"><span className="text-[11px] text-slate-500">{item.count}</span><div className="w-full max-w-8 rounded-t bg-emerald-600" style={{ height: `${Math.max(4, item.count / maxCount * 72)}%` }}/><small className="whitespace-nowrap text-[10px] text-slate-500">{item.hour.slice(11, 16)}</small></div>) : <p className="m-auto text-xs text-slate-500">No production data is recorded for this date range.</p>}</div>
    </Panel>
    <Panel className="flex min-h-64 flex-1 flex-col" title="Recorded cycle data" subtitle={`${report?.cycles?.length || 0} cycle records in this date range`}>
      <CycleTable className="min-h-0 flex-1" rows={report?.cycles || []}/>
    </Panel>
    <p className="shrink-0 text-right text-[11px] text-slate-500">Report range selected {clock.toLocaleDateString()} · API date filters use UTC.</p>
  </div>
}

function downloadCsv(rows) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`
  const stages = ['stage0', 'stage1', 'stage2']
  const header = ['Cycle ID', 'Video', 'Started at', ...stages.map(stage => `${stage} entered at`), 'Completed at', ...stages.map(stage => `${stage} seconds`), 'Total seconds', 'Status']
  const data = [header, ...rows.map(cycle => [cycle.cycleId, cycle.sourceVideo, cycle.startedAt, ...stages.map(stage => cycle.stageTimeline?.find(event => event.stage === stage)?.enteredAt), cycle.completedAt, ...stages.map(stage => cycle.stageDurationsSeconds?.[stage]), cycle.durationSeconds, cycle.status])].map(row => row.map(quote).join(',')).join('\r\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([data], { type: 'text/csv' }))
  link.download = 'box-folding-cycles.csv'
  link.click()
  URL.revokeObjectURL(link.href)
}

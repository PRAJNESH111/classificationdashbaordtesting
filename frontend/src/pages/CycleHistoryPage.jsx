import { useMemo, useState } from 'react'
import { CycleTable, Panel } from '../components/ProductionPanels'
import { useProduction } from '../context/useProduction'

export default function CycleHistoryPage() {
  const { cycles } = useProduction()
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => cycles.filter(cycle => `${cycle.cycleId} ${cycle.status} ${cycle.sourceVideo}`.toLowerCase().includes(filter.toLowerCase())), [cycles, filter])
  return <Panel className="flex h-full min-h-0 flex-col" title="Cycle history" subtitle={`${cycles.length} completed cycles received`} action={<input aria-label="Search cycle history" className="w-44 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-emerald-600" placeholder="Search cycles…" value={filter} onChange={event => setFilter(event.target.value)}/> }>
    <CycleTable className="min-h-0 flex-1" rows={filtered}/>
  </Panel>
}

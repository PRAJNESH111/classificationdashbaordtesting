import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
/* React-Toastify imports are kept commented so notifications can be re-enabled later.
import { useEffect, useRef } from 'react'
import { ToastContainer, toast } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { calculateStageElapsedSeconds, calculateStageOverrun, stageTarget } from './utils/productionMetrics'
import { shortDuration, STAGE_LABELS } from './utils/productionFormatters'
*/
import { ProductionProvider } from './context/ProductionContext'
import { useProduction } from './context/useProduction'
import { StatusPill } from './components/ProductionPanels'
import LiveFeedPage from './pages/LiveFeedPage'
import LiveFloorPage from './pages/LiveFloorPage'
import ReportsPage from './pages/ReportsPage'
import CycleHistoryPage from './pages/CycleHistoryPage'
import SettingsPage from './pages/SettingsPage'

const mainLinks = [
  ['/production', 'Production'],
  ['/reports', 'Reports'],
  ['/cycles', 'Cycle history'],
  ['/settings', 'Settings'],
]

function SupervisorLayout() {
  const { operating, serviceIssue, detectionFailure, service, connection, clock, refresh } = useProduction()
  const connectionTone = connection === 'connected' ? 'green' : connection === 'reconnecting' ? 'amber' : connection === 'connecting' ? 'gray' : 'red'

  return <div className="flex h-dvh w-full flex-col overflow-hidden bg-slate-100 text-slate-900">
    {/* React-Toastify is disabled for now. */}
    <header className="border-b border-indigo-950 bg-indigo-950 text-white shadow-sm">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-20 flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-indigo-300/20 bg-indigo-800 text-xs font-black tracking-widest text-indigo-100">FW</span>
            <div className="min-w-0"><p className="text-[10px] font-bold tracking-[0.22em] text-indigo-200">FOLDWISE</p><h1 className="mt-0.5 truncate text-base font-bold tracking-tight sm:text-lg">Box Folding Production Monitor</h1></div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <div className="hidden text-right md:block"><p className="text-[10px] font-semibold tracking-widest text-indigo-300">BAY 1</p><p className="mt-1 text-xs font-semibold text-indigo-100">{clock.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {clock.toLocaleTimeString()}</p></div>
            <button type="button" onClick={refresh} className="rounded-lg border border-indigo-700 bg-indigo-900 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-100 transition hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Refresh</button>
            <StatusPill compact tone={connectionTone}>{connection.toUpperCase()}</StatusPill>
            <span className="w-[5rem] [&>span]:w-full [&>span]:justify-center"><StatusPill compact tone={operating.tone}>{operating.known ? operating.label : 'WAITING'}</StatusPill></span>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-indigo-800/80 py-2 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Production pages" className="order-2 flex items-center gap-1 overflow-x-auto sm:order-1">
            {mainLinks.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => `shrink-0 rounded-md px-3 py-1.5 text-[11px] font-medium transition ${isActive ? 'bg-indigo-800 text-white' : 'text-indigo-200 hover:bg-indigo-900 hover:text-white'}`}>{label}</NavLink>)}
          </nav>
          <nav aria-label="Live monitoring tabs" className="order-1 ml-auto flex w-fit items-center rounded-lg border border-indigo-700 bg-indigo-900/80 p-1 sm:order-2">
            <NavLink end to="/" className={({ isActive }) => `rounded-md px-4 py-1.5 text-[11px] font-bold transition sm:px-5 ${isActive ? 'bg-white text-indigo-950 shadow-sm' : 'text-indigo-200 hover:text-white'}`}>Live floor</NavLink>
            <NavLink to="/live-feed" className={({ isActive }) => `rounded-md px-4 py-1.5 text-[11px] font-bold transition sm:px-5 ${isActive ? 'bg-white text-indigo-950 shadow-sm' : 'text-indigo-200 hover:text-white'}`}>Live feed</NavLink>
            <NavLink to="/live-feed-1" className={({ isActive }) => `rounded-md px-4 py-1.5 text-[11px] font-bold transition sm:px-5 ${isActive ? 'bg-white text-indigo-950 shadow-sm' : 'text-indigo-200 hover:text-white'}`}>Live feed 1</NavLink>
          </nav>
        </div>
      </div>
    </header>

    <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden px-4 sm:px-6 lg:px-8">
      {serviceIssue && <div role="status" className="mt-3 mb-2 flex shrink-0 flex-col gap-1 rounded-lg border border-red-200 border-l-4 border-l-red-500 bg-red-50 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
        <b className="text-xs text-red-900">{detectionFailure ? 'Detection service fault' : connection === 'disconnected' ? 'Live connection lost' : !service.backend ? 'Backend unavailable' : 'Detection service unavailable'}</b>
        <span className="text-xs text-red-800">{detectionFailure ? service.health?.error : !service.backend ? 'Backend is unavailable; live status may be out of date.' : !service.detection ? 'Video and detections are currently unavailable.' : connection === 'disconnected' ? 'SignalR is disconnected; status may be out of date.' : 'Waiting for a confirmed process status update.'}</span>
      </div>}
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto py-3"><Outlet/></div>
      </main>
  </div>
}

/* React-Toastify notifications are disabled for now.
function ProductionNotifications() {
  const { alerts, status, stageMetrics, clock } = useProduction()
  const seenAlerts = useRef(null)
  const notifiedOverruns = useRef(new Set())
  const cycle = status.activeCycle
  const stage = cycle?.currentStage
  const elapsed = calculateStageElapsedSeconds(cycle, status.updatedAt, clock.getTime())
  const target = stage ? stageTarget(stageMetrics, stage) : null
  const overrun = calculateStageOverrun(target, elapsed)

  useEffect(() => {
    if (seenAlerts.current === null) {
      seenAlerts.current = new Set(alerts.map(alert => alert.id))
      return
    }

    for (const alert of alerts) {
      if (seenAlerts.current.has(alert.id)) continue
      seenAlerts.current.add(alert.id)
      if (alert.type === 'idle') {
        toast.error(alert.title, { toastId: 'operator-idle-alert' })
      }
    }
  }, [alerts])

  useEffect(() => {
    if (!cycle || !stage || overrun <= 0) return
    const cycleKey = cycle.cycleId || cycle.startedAt
    const notificationId = `${cycleKey}:${stage}`
    if (notifiedOverruns.current.has(notificationId)) return
    notifiedOverruns.current.add(notificationId)
    toast.warning(`${STAGE_LABELS[stage] || stage} is over target by ${shortDuration(overrun)}`, {
      toastId: `stage-overrun:${notificationId}`,
    })
  }, [cycle, stage, overrun])

  return null
}
*/

export default function App() {
  return <ProductionProvider><Routes>
    <Route element={<SupervisorLayout/>}>
      <Route index element={<LiveFloorPage/>}/>
      <Route path="live-feed" element={<LiveFeedPage/>}/>
      <Route path="live-feed-1" element={<LiveFeedPage showAllStages/>}/>
      <Route path="production" element={<ReportsPage productionView/>}/>
      <Route path="reports" element={<ReportsPage/>}/>
      <Route path="cycles" element={<CycleHistoryPage/>}/>
      <Route path="settings" element={<SettingsPage/>}/>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Route>
  </Routes></ProductionProvider>
}

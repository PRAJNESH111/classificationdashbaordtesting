import { useCallback, useEffect, useMemo, useState } from 'react'
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'
import './App.css'
import './stages.css'
import './status-colors.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const VIDEO = import.meta.env.VITE_VIDEO_URL || 'http://localhost:8000/video'
const SIGNALR = import.meta.env.VITE_SIGNALR_URL || `${API}/hubs/monitoring`
const classNames = ['workarea', 'stage0', 'stage1', 'stage2', 'hand', 'idlehand']
const classLabels = { workarea: 'Work area', stage0: 'Stage 0', stage1: 'Stage 1', stage2: 'Stage 2', hand: 'Hand', idlehand: 'Idle hand' }
const stageNames = ['stage0', 'stage1', 'stage2']
const titles = { dashboard: 'Dashboard', monitoring: 'Live monitoring', production: 'Production overview', cycles: 'Cycle history', reports: 'Reports', settings: 'Settings' }
const emptyStatus = { state: 'unavailable', processState: 'waiting', detections: [], updatedAt: null, activeCycle: null }

function duration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const n = Math.max(0, Math.floor(Number(seconds)))
  return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s`
}
function formatTimestamp(value) { return value ? new Date(value).toLocaleString() : '—' }
function settingTone([label, value]) {
  if (label === 'Inference device') return value === 'CPU' ? 'gray' : 'green'
  if (label === 'SignalR' && value === 'reconnecting') return 'amber'
  if (label === 'SignalR' && value === 'connecting') return 'gray'
  if (label === 'SignalR' && value === 'disconnected') return 'red'
  if (['Available', 'Connected', 'connected'].includes(value)) return 'green'
  if (['Missing', 'Disconnected'].includes(value)) return 'red'
  return 'gray'
}
function App() {
  const [page, setPage] = useState('dashboard')
  const [status, setStatus] = useState(emptyStatus)
  const [cycles, setCycles] = useState([])
  const [service, setService] = useState({ backend: false, detection: false, health: null })
  const [lastUpdate, setLastUpdate] = useState(null)
  const [connection, setConnection] = useState('connecting')
  const [filter, setFilter] = useState('')
  const [report, setReport] = useState(null)
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10))
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10))

  const load = useCallback(async () => {
    try {
      const [s, c, h, d, r] = await Promise.all([
        fetch(`${API}/api/monitoring/status`), fetch(`${API}/api/cycles?page=1&pageSize=100`),
        fetch(`${API}/health`), fetch('http://localhost:8000/health'), fetch(`${API}/api/reports/summary?from=${encodeURIComponent(`${fromDate}T00:00:00Z`)}&to=${encodeURIComponent(`${toDate}T23:59:59.999Z`)}`),
      ])
      if (s.ok) { const value = await s.json(); setStatus(value); if (value.updatedAt) setLastUpdate(value.updatedAt) }
      if (c.ok) setCycles((await c.json()).items || [])
      if (h.ok) setService(v => ({ ...v, backend: true }))
      if (d.ok) { const health = await d.json(); setService(v => ({ ...v, detection: Boolean(health.running), health })) }
      if (r.ok) setReport(await r.json())
    } catch { setService(v => ({ ...v, backend: false })) }
  }, [fromDate, toDate])

  useEffect(() => { let active = true; Promise.resolve().then(() => active && load()); return () => { active = false } }, [load])
  useEffect(() => {
    let alive = true
    let started = false
    const hub = new HubConnectionBuilder().withUrl(SIGNALR).withAutomaticReconnect().configureLogging(LogLevel.Error).build()
    const onStatus = value => { if (alive) { setStatus(value); setLastUpdate(value.updatedAt || new Date().toISOString()) } }
    const onCycle = value => { if (alive) { setCycles(current => [value, ...current.filter(c => c.cycleId !== value.cycleId)]); setStatus(current => ({ ...current, state: 'completed', processState: 'completed', currentStage: 'stage2', activeCycle: null, lastCompletedCycle: value })) } }
    hub.on('StatusUpdated', onStatus); hub.on('CycleCompleted', onCycle)
    hub.onreconnecting(() => alive && setConnection('reconnecting'))
    hub.onreconnected(async () => { if (alive) { setConnection('connected'); await load() } })
    hub.start().then(async () => {
      started = true
      if (!alive) { await hub.stop(); return }
      setConnection('connected')
    }).catch(() => alive && setConnection('disconnected'))
    const timer = setInterval(load, 15000)
    return () => { alive = false; clearInterval(timer); hub.off('StatusUpdated', onStatus); hub.off('CycleCompleted', onCycle); if (started) hub.stop() }
  }, [load])

  const filteredCycles = useMemo(() => cycles.filter(c => `${c.cycleId} ${c.status}`.toLowerCase().includes(filter.toLowerCase())), [cycles, filter])
  const countToday = cycles.filter(c => new Date(c.completedAt).toDateString() === new Date().toDateString()).length
  const average = cycles.length ? cycles.reduce((sum, c) => sum + Number(c.durationSeconds || 0), 0) / cycles.length : null
  const latest = status.detections || []
  const detectionFailure = Boolean(service.health?.error && service.health.error !== 'Video sequence finished')
  const detectionTone = service.detection ? 'green' : detectionFailure ? 'red' : 'gray'
  const processStatus = status.processState === 'running' ? 'Running' : status.processState === 'idle' ? 'Idle' : status.processState === 'completed' || status.state === 'completed' ? 'Completed' : status.activeCycle ? 'In progress' : 'Waiting'
  const processTone = status.processState === 'idle' || status.processState === 'waiting' ? 'gray' : status.activeCycle?.completionPending ? 'amber' : status.processState === 'running' || status.processState === 'in_progress' || status.processState === 'completed' || status.state === 'completed' ? 'green' : status.state === 'unavailable' && status.error && status.error !== 'Video sequence finished' ? 'red' : 'gray'
  const nav = [['dashboard', '⌂', 'Dashboard'], ['monitoring', '◉', 'Live monitoring'], ['production', '▥', 'Production overview'], ['cycles', '↻', 'Cycle history'], ['reports', '▤', 'Reports'], ['settings', '⚙', 'Settings']]

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="brand-icon">BF</div><div><b>Foldwise</b><small>PRODUCTION SYSTEM</small></div></div>
      <div className="nav-label">WORKSPACE</div><nav>{nav.map(([id, icon, name]) => <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(id)}><span>{icon}</span>{name}</button>)}</nav>
      <div className="side-bottom"><span className={`dot ${service.backend ? 'green' : 'red'}`} /> <span>Backend {service.backend ? 'online' : 'offline'}</span><small>Local workstation</small></div>
    </aside>
    <main className="main"><header className="topbar"><div><div className="crumb">WORKSPACE <span>/</span> {titles[page].toUpperCase()}</div><h1>{titles[page]}</h1></div><div className="top-meta"><span className="live-pill"><i className={`dot ${detectionTone}`} />{service.detection ? 'SYSTEM ACTIVE' : detectionFailure ? 'SERVICE FAILED' : 'OFFLINE'}</span><span className="date-label">{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div></header>
      {page === 'dashboard' && <>
        <div className="welcome"><div><span className="eyebrow">PRODUCTION FLOOR · STATION 01</span><h2>Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, operator</h2><p>Here’s the latest activity from your box folding line.</p></div><button className="refresh" onClick={load}>↻ &nbsp;Refresh data</button></div>
        <div className="metrics"><Metric label="COMPLETED TODAY" value={countToday} foot="Confirmed production cycles" icon="▦" tone={countToday > 0 ? 'green' : 'gray'}/><Metric label="AVERAGE CYCLE TIME" value={duration(average)} foot="Across recorded cycles" icon="◷" tone={average != null ? 'green' : 'gray'}/><Metric label="PROCESS STATUS" value={processStatus} foot={status.activeCycle ? `${classLabels[status.currentStage] || 'Cycle'} · ${duration(status.activeCycle.elapsedSeconds)}` : status.awaitingReset ? 'Waiting for work-area reset' : 'No active cycle'} icon="⌁" tone={processTone}/><Metric label="DETECTION SERVICE" value={service.detection ? 'Online' : detectionFailure ? 'Failed' : 'Offline'} foot={service.health?.error || 'Model and video service health'} icon="◉" tone={detectionTone}/> </div>
        <section className="panel stage-panel"><PanelHead title="Current process stages" subtitle={status.activeCycle ? `Cycle started ${formatTimestamp(status.activeCycle.startedAt)}` : 'Three confirmed model stages for one box cycle'}/><div className="stage-panel-content"><StageProgress cycle={status.activeCycle || status.lastCompletedCycle} completed={!status.activeCycle && status.lastCompletedCycle?.status === 'completed'}/><div className={`operator-chip tone-${status.operatorState === 'active' ? 'green' : 'gray'}`}>Operator: <b>{status.operatorState || 'unknown'}</b>{status.awaitingReset && <span>Waiting for work area reset</span>}</div></div></section>
        <div className="grid main-grid"><section className="panel video-panel"><PanelHead title="Live process feed" subtitle="Annotated video · real-time inference" action={<span className="live-pill"><i className={`dot ${detectionTone}`} />{service.detection ? 'LIVE' : detectionFailure ? 'FAILED' : 'OFFLINE'}</span>}/><div className="video-wrap">{service.detection ? <img src={VIDEO} alt="Annotated box folding process video" onError={() => setService(v => ({ ...v, detection: false }))}/> : <div className="video-empty"><span>▣</span><b>Video feed unavailable</b><p>{service.health?.error || 'Check vid1.mp4, vid2.mp4 and vid3.mp4 in detection-service/videos/'}</p></div>}<div className="video-caption"><span>STATION 01 · {status.videoName || 'RECORDED VIDEO'}</span><span>{lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'NO FRAME YET'}</span></div></div></section>
        <section className="panel detect-panel"><PanelHead title="Detection status" subtitle="Current frame · class confidence"/><div className="detect-list">{classNames.map(name => { const d = latest.filter(x => x.className === name).sort((a,b) => b.confidence-a.confidence)[0]; return <div className="detect-row" key={name}><span className={`detect-icon ${name}`}>{name === 'hand' || name === 'idlehand' ? '✋' : '□'}</span><div className="detect-info"><b>{classLabels[name]}</b><small>{d ? 'Detected in current frame' : 'Not detected'}</small></div><strong className={d ? 'confidence' : 'muted'}>{d ? `${Math.round(d.confidence * 100)}%` : '—'}</strong></div>})}</div><div className="detect-foot">Last successful update <b>{lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'None received'}</b></div></section>
        <section className="panel chart-panel"><PanelHead title="Hourly production" subtitle="Completed cycles recorded today"/><div className="chart">{(report?.hourly || []).length ? report.hourly.map(x => <div className="bar-col" key={x.hour}><span>{x.count}</span><i style={{height: `${Math.max(6, Math.min(100, x.count * 18))}%`}}/><small>{x.hour.slice(11, 16)}</small></div>) : <div className="empty-note">No completed cycles recorded for this period.</div>}</div></section>
        <section className="panel recent-panel"><PanelHead title="Recent cycles" subtitle="Latest confirmed production activity" action={<button className="text-button" onClick={() => setPage('cycles')}>View history →</button>}/><CycleTable rows={cycles.slice(0, 5)}/></section></div>
      </>}
       {page === 'monitoring' && <section className="panel full-panel"><PanelHead title="Live process monitoring" subtitle="Annotated video and detected classes"/><div className="monitor-layout"><div className="video-wrap large-video">{service.detection ? <img src={VIDEO} alt="Live annotated process feed"/> : <div className="video-empty"><b>Video feed unavailable</b><p>{service.health?.error || 'Check detection service and video file.'}</p></div>}</div><div className="monitor-details"><h3>Process state</h3><p className={`state-text tone-${processTone}`}>{processStatus}</p><p>Current stage: <b>{classLabels[status.currentStage] || 'Waiting'}</b></p><p>Operator state: <b className={`tone-${status.operatorState === 'active' ? 'green' : status.operatorState === 'idle' ? 'gray' : 'gray'}`}>{status.operatorState || 'unknown'}</b></p><p>Cycle started: {formatTimestamp(status.activeCycle?.startedAt || status.lastCompletedCycle?.startedAt)}</p><p>Current stage elapsed: {duration(status.activeCycle?.stageElapsedSeconds)}</p><p>Total elapsed: {duration(status.activeCycle?.elapsedSeconds)}</p><p>SignalR: <b className={`tone-${connection === 'connected' ? 'green' : connection === 'reconnecting' ? 'amber' : connection === 'disconnected' ? 'red' : 'gray'}`}>{connection}</b></p><p>Video source: {status.videoName || (service.health?.videoAvailable ? 'Available' : 'Unavailable')}</p><p>Updated: {lastUpdate ? new Date(lastUpdate).toLocaleString() : 'No update received'}</p><StageProgress cycle={status.activeCycle || status.lastCompletedCycle} completed={!status.activeCycle && status.lastCompletedCycle?.status === 'completed'}/>{classNames.map(n => {const d=latest.find(x=>x.className===n);return <div className="simple-row" key={n}>{classLabels[n]} <b className={d ? 'tone-green' : 'tone-gray'}>{d ? `${Math.round(d.confidence*100)}%` : 'Not detected'}</b></div>})}</div></div></section>}
      {page === 'cycles' && <section className="panel full-panel"><PanelHead title="Cycle history" subtitle={`${cycles.length} completed cycles received`} action={<input className="search" placeholder="Search cycles…" value={filter} onChange={e=>setFilter(e.target.value)}/>}/><CycleTable rows={filteredCycles}/></section>}
      {(page === 'production' || page === 'reports') && <><div className="range-filter"><label>From <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label><label>To <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label><span>Times shown in your browser’s local timezone; API filters use UTC dates.</span></div><div className="metrics"><Metric label="COMPLETED CYCLES" value={report?.completedCycles ?? 0} foot="Filtered reporting period" icon="▦"/><Metric label="AVERAGE DURATION" value={duration(report?.averageDurationSeconds)} foot="Completed cycles only" icon="◷"/><Metric label="FASTEST CYCLE" value={duration(report?.minimumDurationSeconds)} foot="Recorded minimum" icon="↗"/><Metric label="SLOWEST CYCLE" value={duration(report?.maximumDurationSeconds)} foot="Recorded maximum" icon="↘"/><Metric label="AVG STAGE 0" value={duration(report?.averageStageDurationsSeconds?.stage0)} foot="Stage 0 time" icon="1"/><Metric label="AVG STAGE 1" value={duration(report?.averageStageDurationsSeconds?.stage1)} foot="Stage 1 time" icon="2"/><Metric label="AVG STAGE 2" value={duration(report?.averageStageDurationsSeconds?.stage2)} foot="Stage 2 time" icon="3"/></div><section className="panel full-panel"><PanelHead title={page === 'reports' ? 'Production report' : 'Hourly production'} subtitle="Recorded completed cycles"/><div className="chart report-chart">{(report?.hourly || []).length ? report.hourly.map(x=><div className="bar-col" key={x.hour}><span>{x.count}</span><i style={{height:`${Math.max(6,Math.min(100,x.count*18))}%`}}/><small>{x.hour}</small></div>) : <div className="empty-note">No production data is recorded for this date range.</div>}</div></section><section className="panel full-panel"><PanelHead title="Recorded cycle data" subtitle="Actual completed cycle records" action={<button className="refresh" onClick={()=>downloadCsv(report?.cycles || [])}>Export CSV ↓</button>}/><CycleTable rows={report?.cycles || []}/></section></>}
      {page === 'settings' && <section className="panel full-panel"><PanelHead title="System settings" subtitle="Read-only service configuration"/>{[['Model file', service.health?.modelAvailable ? 'Available' : 'Missing', 'detection-service/weights/best.pt'],['Video source',service.health?.videoAvailable ? 'Available' : 'Missing','videos/vid1.mp4 → vid2.mp4 → vid3.mp4'],['Inference device',service.health?.inferenceDevice || 'Checking…','CUDA GPU is selected automatically when available'],['Frame sampling',`${service.health?.frameSkip ?? 3} skipped / 1 processed`,'FRAME_SKIP'],['Detection confidence',`${Math.round((service.health?.stageConfidenceThreshold ?? .8) * 100)}%`,'STAGE_CONFIDENCE_THRESHOLD'],['Stage confirmation',`${service.health?.stageConfirmationDetections ?? 2} detections`,'STAGE_CONFIRMATION_DETECTIONS'],['Stage 2 completion gap',`${service.health?.stage2CompletionGapSeconds ?? 1.0} seconds`,'STAGE2_COMPLETION_GAP_SECONDS'],['Backend API',service.backend?'Connected':'Disconnected',API],['SignalR',connection,SIGNALR]].map(row=><div className="setting-row" key={row[0]}><div><b>{row[0]}</b><small>{row[2]}</small></div><span className={`status-indicator tone-${settingTone(row)}`}>{row[1]}</span></div>)}</section>}
      <footer>Foldwise monitoring prototype <span>·</span> Production data is based on completed detections received by the backend.</footer>
    </main>
  </div>
}

function Metric({label,value,foot,icon,tone}) { return <section className="metric"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong className={tone ? `tone-${tone}` : ''}>{value}</strong><small>{foot}</small></section> }
function PanelHead({title,subtitle,action}) { return <div className="panel-head"><div><h3>{title}</h3><p>{subtitle}</p></div>{action}</div> }
function StageProgress({cycle, completed=false}) {
  const events = cycle?.stageTimeline || []
  const currentIndex = stageNames.indexOf(cycle?.currentStage)
  if (!cycle) return <div className="stage-progress-empty">A cycle will appear after stage0 is confirmed.</div>
  return <div className="stage-progress">
    <div className="stage-track">{stageNames.map((stage, index) => {
      const event = events.find(item => item.stage === stage)
      const state = completed || index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending'
      const stageDuration = cycle.stageDurationsSeconds?.[stage]
      const activeDuration = index === currentIndex && !completed ? cycle.stageElapsedSeconds : stageDuration
      const confirming = !completed && index === currentIndex && cycle.completionPending
      return <div className={`stage-step ${state} ${confirming ? 'confirming' : ''}`} key={stage}>
        <span className="stage-number">{index + 1}</span>
        <span className="stage-copy"><b>{stage}</b><small>{event ? formatTimestamp(event.enteredAt) : 'Not reached'}</small><small>{activeDuration != null ? duration(activeDuration) : '—'}</small></span>
      </div>
    })}</div>
    <div className="stage-total"><span>Started <b>{formatTimestamp(cycle.startedAt)}</b></span><span>{completed ? 'Completed' : 'Elapsed'} <b>{completed ? formatTimestamp(cycle.completedAt) : duration(cycle.elapsedSeconds)}</b></span><span>Total time <b>{completed ? duration(cycle.durationSeconds) : 'In progress'}</b></span></div>
  </div>
}
function CycleTable({rows}) { return <div className="table-scroll"><table><thead><tr><th>CYCLE ID</th><th>VIDEO</th><th>STARTED AT</th><th>STAGE TIMELINE · ENTERED AT</th><th>COMPLETED AT</th><th>TOTAL TIME</th></tr></thead><tbody>{rows.length ? rows.map(c=><tr key={c.cycleId}><td className="cycle-id">{c.cycleId?.slice(0,8) || '—'}</td><td>{c.sourceVideo || '—'}</td><td>{formatTimestamp(c.startedAt)}</td><td><div className="cycle-stage-timeline">{stageNames.map(stage=>{const event=c.stageTimeline?.find(item=>item.stage===stage);return <span key={stage}><b>{stage}</b><small>{formatTimestamp(event?.enteredAt)}</small></span>})}</div></td><td>{formatTimestamp(c.completedAt)}</td><td>{duration(c.durationSeconds)}</td></tr>) : <tr><td colSpan="6" className="empty-row">No completed cycles have been received yet.</td></tr>}</tbody></table></div> }
function downloadCsv(rows) { const quote = v => `"${String(v ?? '').replaceAll('"','""')}"`; const data = [['Cycle ID','Video','Started at','Stage 0 entered at','Stage 1 entered at','Stage 2 entered at','Completed at','Stage 0 seconds','Stage 1 seconds','Stage 2 seconds','Total seconds','Status'], ...rows.map(c=>{const at=stage=>c.stageTimeline?.find(e=>e.stage===stage)?.enteredAt;return [c.cycleId,c.sourceVideo,c.startedAt,at('stage0'),at('stage1'),at('stage2'),c.completedAt,c.stageDurationsSeconds?.stage0,c.stageDurationsSeconds?.stage1,c.stageDurationsSeconds?.stage2,c.durationSeconds,c.status]})].map(row=>row.map(quote).join(',')).join('\r\n'); const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([data],{type:'text/csv'}));link.download='box-folding-cycles.csv';link.click();URL.revokeObjectURL(link.href) }
export default App

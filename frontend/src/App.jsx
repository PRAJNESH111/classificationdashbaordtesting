import { useCallback, useEffect, useMemo, useState } from 'react'
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'
import './App.css'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const VIDEO = import.meta.env.VITE_VIDEO_URL || 'http://localhost:8000/video'
const SIGNALR = import.meta.env.VITE_SIGNALR_URL || `${API}/hubs/monitoring`
const classNames = ['work_area', 'raw_box', 'folded_box', 'hand']
const titles = { dashboard: 'Dashboard', monitoring: 'Live monitoring', production: 'Production overview', cycles: 'Cycle history', reports: 'Reports', settings: 'Settings' }
const emptyStatus = { state: 'unavailable', detections: [], updatedAt: null, activeCycle: null }

function duration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const n = Math.max(0, Math.floor(Number(seconds)))
  return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s`
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
    const onCycle = value => { if (alive) setCycles(current => [value, ...current.filter(c => c.cycleId !== value.cycleId)]) }
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
  const nav = [['dashboard', '⌂', 'Dashboard'], ['monitoring', '◉', 'Live monitoring'], ['production', '▥', 'Production overview'], ['cycles', '↻', 'Cycle history'], ['reports', '▤', 'Reports'], ['settings', '⚙', 'Settings']]

  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="brand-icon">BF</div><div><b>Foldwise</b><small>PRODUCTION SYSTEM</small></div></div>
      <div className="nav-label">WORKSPACE</div><nav>{nav.map(([id, icon, name]) => <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(id)}><span>{icon}</span>{name}</button>)}</nav>
      <div className="side-bottom"><span className={`dot ${service.backend ? 'green' : 'red'}`} /> <span>Backend {service.backend ? 'online' : 'offline'}</span><small>Local workstation</small></div>
    </aside>
    <main className="main"><header className="topbar"><div><div className="crumb">WORKSPACE <span>/</span> {titles[page].toUpperCase()}</div><h1>{titles[page]}</h1></div><div className="top-meta"><span className="live-pill"><i className={service.detection ? 'dot green' : 'dot amber'} />{service.detection ? 'SYSTEM ACTIVE' : 'SERVICE UNAVAILABLE'}</span><span className="date-label">{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div></header>
      {page === 'dashboard' && <>
        <div className="welcome"><div><span className="eyebrow">PRODUCTION FLOOR · STATION 01</span><h2>Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, operator</h2><p>Here’s the latest activity from your box folding line.</p></div><button className="refresh" onClick={load}>↻ &nbsp;Refresh data</button></div>
        <div className="metrics"><Metric label="COMPLETED TODAY" value={countToday} foot="Confirmed production cycles" icon="▦"/><Metric label="AVERAGE CYCLE TIME" value={duration(average)} foot="Across recorded cycles" icon="◷"/><Metric label="PROCESS STATUS" value={status.state?.replace('_', ' ') || 'unavailable'} foot={status.activeCycle ? `Active for ${duration(status.activeCycle.elapsedSeconds)}` : 'Waiting for process activity'} icon="⌁"/><Metric label="DETECTION SERVICE" value={service.detection ? 'Online' : 'Offline'} foot={service.health?.error || 'Model and video service health'} icon="◉"/> </div>
        <div className="grid main-grid"><section className="panel video-panel"><PanelHead title="Live process feed" subtitle="Annotated video · real-time inference" action={<span className="live-pill"><i className={`dot ${service.detection ? 'green' : 'red'}`} />{service.detection ? 'LIVE' : 'OFFLINE'}</span>}/><div className="video-wrap">{service.detection ? <img src={VIDEO} alt="Annotated box folding process video" onError={() => setService(v => ({ ...v, detection: false }))}/> : <div className="video-empty"><span>▣</span><b>Video feed unavailable</b><p>{service.health?.error || 'Check vid1.mp4, vid2.mp4 and vid3.mp4 in detection-service/videos/'}</p></div>}<div className="video-caption"><span>STATION 01 · {status.videoName || 'RECORDED VIDEO'}</span><span>{lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'NO FRAME YET'}</span></div></div></section>
        <section className="panel detect-panel"><PanelHead title="Detection status" subtitle="Current frame · class confidence"/><div className="detect-list">{classNames.map(name => { const d = latest.filter(x => x.className === name).sort((a,b) => b.confidence-a.confidence)[0]; return <div className="detect-row" key={name}><span className={`detect-icon ${name}`}>{name === 'hand' ? '✋' : '□'}</span><div className="detect-info"><b>{name.replace('_', ' ')}</b><small>{d ? 'Detected in current frame' : 'Not detected'}</small></div><strong className={d ? 'confidence' : 'muted'}>{d ? `${Math.round(d.confidence * 100)}%` : '—'}</strong></div>})}</div><div className="detect-foot">Last successful update <b>{lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : 'None received'}</b></div></section>
        <section className="panel chart-panel"><PanelHead title="Hourly production" subtitle="Completed cycles recorded today"/><div className="chart">{(report?.hourly || []).length ? report.hourly.map(x => <div className="bar-col" key={x.hour}><span>{x.count}</span><i style={{height: `${Math.max(6, Math.min(100, x.count * 18))}%`}}/><small>{x.hour.slice(11, 16)}</small></div>) : <div className="empty-note">No completed cycles recorded for this period.</div>}</div></section>
        <section className="panel recent-panel"><PanelHead title="Recent cycles" subtitle="Latest confirmed production activity" action={<button className="text-button" onClick={() => setPage('cycles')}>View history →</button>}/><CycleTable rows={cycles.slice(0, 5)}/></section></div>
      </>}
      {page === 'monitoring' && <section className="panel full-panel"><PanelHead title="Live process monitoring" subtitle="Annotated video and detected classes"/><div className="monitor-layout"><div className="video-wrap large-video">{service.detection ? <img src={VIDEO} alt="Live annotated process feed"/> : <div className="video-empty"><b>Video feed unavailable</b><p>{service.health?.error || 'Check detection service and video file.'}</p></div>}</div><div className="monitor-details"><h3>Process state</h3><p className="state-text">{status.state || 'unavailable'}</p><p>Active cycle: {duration(status.activeCycle?.elapsedSeconds)}</p><p>SignalR: <b>{connection}</b></p><p>Video source: {service.health?.videoAvailable ? 'Available' : 'Unavailable'}</p><p>Updated: {lastUpdate ? new Date(lastUpdate).toLocaleString() : 'No update received'}</p>{classNames.map(n => {const d=latest.find(x=>x.className===n);return <div className="simple-row" key={n}>{n.replace('_',' ')} <b>{d ? `${Math.round(d.confidence*100)}%` : 'Not detected'}</b></div>})}</div></div></section>}
      {page === 'cycles' && <section className="panel full-panel"><PanelHead title="Cycle history" subtitle={`${cycles.length} completed cycles received`} action={<input className="search" placeholder="Search cycles…" value={filter} onChange={e=>setFilter(e.target.value)}/>}/><CycleTable rows={filteredCycles}/></section>}
      {(page === 'production' || page === 'reports') && <><div className="range-filter"><label>From <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}/></label><label>To <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}/></label><span>Times shown in your browser’s local timezone; API filters use UTC dates.</span></div><div className="metrics"><Metric label="COMPLETED CYCLES" value={report?.completedCycles ?? 0} foot="Filtered reporting period" icon="▦"/><Metric label="AVERAGE DURATION" value={duration(report?.averageDurationSeconds)} foot="Completed cycles only" icon="◷"/><Metric label="FASTEST CYCLE" value={duration(report?.minimumDurationSeconds)} foot="Recorded minimum" icon="↗"/><Metric label="SLOWEST CYCLE" value={duration(report?.maximumDurationSeconds)} foot="Recorded maximum" icon="↘"/></div><section className="panel full-panel"><PanelHead title={page === 'reports' ? 'Production report' : 'Hourly production'} subtitle="Recorded completed cycles"/><div className="chart report-chart">{(report?.hourly || []).length ? report.hourly.map(x=><div className="bar-col" key={x.hour}><span>{x.count}</span><i style={{height:`${Math.max(6,Math.min(100,x.count*18))}%`}}/><small>{x.hour}</small></div>) : <div className="empty-note">No production data is recorded for this date range.</div>}</div></section><section className="panel full-panel"><PanelHead title="Recorded cycle data" subtitle="Actual completed cycle records" action={<button className="refresh" onClick={()=>downloadCsv(report?.cycles || [])}>Export CSV ↓</button>}/><CycleTable rows={report?.cycles || []}/></section></>}
      {page === 'settings' && <section className="panel full-panel"><PanelHead title="System settings" subtitle="Read-only service configuration"/>{[['Model file', service.health?.modelAvailable ? 'Available' : 'Missing', 'detection-service/weights/best.pt'],['Video source',service.health?.videoAvailable ? 'Available' : 'Missing','videos/vid1.mp4 → vid2.mp4 → vid3.mp4'],['Inference device',service.health?.inferenceDevice || 'Checking…','CUDA GPU is selected automatically when available'],['Frame sampling',`${service.health?.frameSkip ?? 3} skipped / 1 processed`,'FRAME_SKIP'],['Inference confidence','50%','CONFIDENCE_THRESHOLD'],['Folded-box confirmation','80%','FOLDED_CONFIRMATION_THRESHOLD'],['Completion gap',`${service.health?.foldedCompletionGapSeconds ?? 1.0} seconds`,'FOLDED_COMPLETION_GAP_SECONDS'],['Backend API',service.backend?'Connected':'Disconnected',API],['SignalR',connection,SIGNALR]].map(row=><div className="setting-row" key={row[0]}><div><b>{row[0]}</b><small>{row[2]}</small></div><span className={row[1]==='Available'||row[1]==='Connected'||row[1]==='connected'||row[0]==='Inference device'&&row[1]!=='CPU'?'status-good':'status-bad'}>{row[1]}</span></div>)}</section>}
      <footer>Foldwise monitoring prototype <span>·</span> Production data is based on completed detections received by the backend.</footer>
    </main>
  </div>
}

function Metric({label,value,foot,icon}) { return <section className="metric"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{foot}</small></section> }
function PanelHead({title,subtitle,action}) { return <div className="panel-head"><div><h3>{title}</h3><p>{subtitle}</p></div>{action}</div> }
function CycleTable({rows}) { return <div className="table-scroll"><table><thead><tr><th>CYCLE ID</th><th>STARTED</th><th>COMPLETED</th><th>DURATION</th><th>STATUS</th></tr></thead><tbody>{rows.length ? rows.map(c=><tr key={c.cycleId}><td className="cycle-id">{c.cycleId?.slice(0,8) || '—'}</td><td>{c.startedAt?new Date(c.startedAt).toLocaleString():'—'}</td><td>{c.completedAt?new Date(c.completedAt).toLocaleString():'—'}</td><td>{duration(c.durationSeconds)}</td><td><span className="status-good">● &nbsp;Completed</span></td></tr>) : <tr><td colSpan="5" className="empty-row">No completed cycles have been received yet.</td></tr>}</tbody></table></div> }
function downloadCsv(rows) { const quote = v => `"${String(v ?? '').replaceAll('"','""')}"`; const data = [['Cycle ID','Started at','Completed at','Duration seconds','Status'], ...rows.map(c=>[c.cycleId,c.startedAt,c.completedAt,c.durationSeconds,c.status])].map(row=>row.map(quote).join(',')).join('\r\n'); const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([data],{type:'text/csv'}));link.download='box-folding-cycles.csv';link.click();URL.revokeObjectURL(link.href) }
export default App

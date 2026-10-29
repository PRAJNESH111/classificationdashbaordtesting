import { Panel } from '../components/ProductionPanels'
import { useProduction } from '../context/useProduction'

const API = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const SIGNALR = import.meta.env.VITE_SIGNALR_URL || `${API}/hubs/monitoring`

function statusTone(value) {
  if (['Available', 'Connected', 'connected'].includes(value)) return 'text-emerald-700'
  if (['Missing', 'Disconnected', 'disconnected'].includes(value)) return 'text-red-700'
  if (['reconnecting'].includes(value)) return 'text-amber-700'
  return 'text-slate-700'
}

export default function SettingsPage() {
  const { service, connection } = useProduction()
  const settings = [
    ['Model file', service.health?.modelAvailable ? 'Available' : 'Missing', 'detection-service/weights/best.pt'],
    ['Video source', service.health?.videoAvailable ? 'Available' : 'Missing', (service.health?.videos || []).join(' → ') || 'Configured sequence'],
    ['Inference device', service.health?.inferenceDevice || 'Checking…', 'CUDA is selected when available; CPU remains supported'],
    ['Frame sampling', `${service.health?.frameSkip ?? 0} skipped / 1 processed`, 'FRAME_SKIP'],
    ['Detection confidence', `${Math.round((service.health?.stageConfidenceThreshold ?? 0.8) * 100)}%`, 'STAGE_CONFIDENCE_THRESHOLD'],
    ['Stage confirmation', `${service.health?.stageConfirmationDetections ?? 2} detections`, 'STAGE_CONFIRMATION_DETECTIONS'],
    ['Stage 2 completion gap', `${service.health?.stage2CompletionGapSeconds ?? 1} seconds`, 'STAGE2_COMPLETION_GAP_SECONDS'],
    ['Backend API', service.backend ? 'Connected' : 'Disconnected', API],
    ['SignalR', connection, SIGNALR],
  ]
  return <Panel className="flex h-full min-h-0 flex-col" title="System settings" subtitle="Read-only service configuration">
    <dl className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto px-5">{settings.map(([label, value, detail]) => <div key={label} className="flex flex-col justify-between gap-2 py-2.5 sm:flex-row sm:items-center"><div><dt className="text-sm font-semibold text-slate-800">{label}</dt><dd className="mt-1 break-all font-mono text-xs text-slate-500">{detail}</dd></div><span className={`text-xs font-bold ${statusTone(value)}`}>{value}</span></div>)}</dl>
  </Panel>
}

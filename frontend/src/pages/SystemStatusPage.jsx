import { useSystemStatus } from '../api/admin'

function formatBytes(bytes) {
  if (bytes == null) return 'Unknown'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(value) {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusPill({ ok, label }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
      ok ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
    }`}>
      {label ?? (ok ? 'OK' : 'Check')}
    </span>
  )
}

function Section({ title, children }) {
  return (
    <section className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-800 mb-3">{title}</h2>
      {children}
    </section>
  )
}

function ConfigRow({ label, ok }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-gray-600">{label}</span>
      <StatusPill ok={ok} />
    </div>
  )
}

function ClaimList({ claims }) {
  if (!claims?.length) {
    return <p className="text-sm text-gray-400">None found.</p>
  }
  return (
    <div className="space-y-2">
      {claims.map((claim) => (
        <div key={claim.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-gray-800 break-all">
              {claim.reference_code || claim.id}
            </p>
            <span className="shrink-0 text-xs text-gray-400">{formatDate(claim.updated_at)}</span>
          </div>
          {claim.error_message && claim.error_message !== '__generating__' && (
            <p className="mt-1 text-xs text-red-600 line-clamp-2">{claim.error_message}</p>
          )}
        </div>
      ))}
    </div>
  )
}

export default function SystemStatusPage() {
  const { data, isLoading, isError, refetch } = useSystemStatus()

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-red-500">Failed to load system status.</p>
        <button onClick={() => refetch()} className="mt-3 text-sm font-medium text-blue-600">
          Try again
        </button>
      </div>
    )
  }

  const config = data?.config ?? {}
  const limits = data?.limits ?? {}
  const origins = config.allowed_origins ?? []

  return (
    <div className="min-h-full bg-gray-50 p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">System Status</h1>
            <p className="text-xs text-gray-400">Operational checks for the free-tier deployment.</p>
          </div>
          <StatusPill ok={data?.status === 'ok'} label={data?.status === 'ok' ? 'Healthy' : 'Degraded'} />
        </div>

        <Section title="Core Services">
          <ConfigRow label="Supabase" ok={data?.database?.status === 'ok'} />
          <ConfigRow label="Telegram bot token" ok={config.telegram_bot_token_set} />
          <ConfigRow label="Webhook secret" ok={config.telegram_webhook_secret_set} />
          <ConfigRow label="Google Drive" ok={config.drive_refresh_token_set && config.google_drive_parent_folder_set} />
          <ConfigRow label="Gmail" ok={config.gmail_refresh_token_set} />
          <ConfigRow label="Cloudflare R2" ok={config.r2_config_set} />
        </Section>

        <Section title="Frontend Origins">
          <div className="space-y-1.5">
            {origins.map((origin) => (
              <p key={origin} className="break-all rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                {origin}
              </p>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">These must match the browser origin exactly.</p>
        </Section>

        <Section title="Free-Tier Limits">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">Upload cap</p>
              <p className="font-semibold text-gray-800">{formatBytes(limits.max_upload_bytes)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">PDF pages</p>
              <p className="font-semibold text-gray-800">{limits.max_pdf_pages}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Doc workers</p>
              <p className="font-semibold text-gray-800">{limits.docgen_max_workers}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">R2 limit</p>
              <p className="font-semibold text-gray-800">{formatBytes(limits.r2_storage_limit_bytes)}</p>
            </div>
          </div>
        </Section>

        <Section title="Stuck Generation Locks">
          <ClaimList claims={data?.documents?.stuck_generations ?? []} />
        </Section>

        <Section title="Recent Error Claims">
          <ClaimList claims={data?.claims?.error_claims ?? []} />
        </Section>
      </div>
    </div>
  )
}

import { useBackfillStorageSizes, useStorageSummary, useSystemStatus } from '../api/admin'

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

function ConfigRow({ label, ok, statusLabel }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-gray-600">{label}</span>
      <StatusPill ok={ok} label={statusLabel} />
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
  const { data: storage } = useStorageSummary()
  const backfillMut = useBackfillStorageSizes()

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
  const driveOk = config.drive_refresh_token_set && config.google_drive_parent_folder_set && config.drive_auth_status === 'ok'
  const driveStatusLabel = !config.drive_refresh_token_set || !config.google_drive_parent_folder_set
    ? 'Missing'
    : config.drive_auth_status === 'ok'
    ? 'OK'
    : 'Check'
  const usagePercent = storage?.usage_ratio == null ? null : Math.min(100, storage.usage_ratio * 100)
  const unknownFileCount = (storage?.sources ?? []).reduce((sum, source) => (
    sum + (source.unknown_file_count || 0)
  ), 0)

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
          <ConfigRow
            label="Webhook secret"
            ok={config.telegram_webhook_secret_set}
            statusLabel={config.telegram_webhook_secret_explicit ? 'Explicit' : 'Fallback'}
          />
          <ConfigRow label="Google Drive" ok={driveOk} statusLabel={driveStatusLabel} />
          <ConfigRow label="Gmail" ok={config.gmail_refresh_token_set} />
          <ConfigRow label="Cloudflare R2" ok={config.r2_config_set} />
          {config.drive_auth_error && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {config.drive_auth_error}
            </p>
          )}
          {!config.telegram_webhook_secret_explicit && config.telegram_webhook_secret_set && (
            <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Fallback is active. Set TELEGRAM_WEBHOOK_SECRET_TOKEN in GitHub Actions and Cloud Run only if you want an explicit secret.
            </p>
          )}
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

        <Section title="Storage Usage">
          <div className="mb-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-gray-400">Tracked R2 usage</p>
                <p className="text-lg font-bold text-gray-900">{formatBytes(storage?.r2_known_bytes ?? 0)}</p>
              </div>
              <p className="text-xs text-gray-500">
                {usagePercent == null ? 'Unknown' : `${usagePercent.toFixed(2)}%`} of {formatBytes(storage?.limit_bytes ?? limits.r2_storage_limit_bytes)}
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-blue-600"
                style={{ width: `${usagePercent ?? 0}%` }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            {(storage?.sources ?? []).map((source) => (
              <div key={source.table} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-gray-600">{source.label}</span>
                <span className="text-gray-400">
                  {formatBytes(source.known_bytes)} {source.storage === 'drive' ? 'Drive' : 'R2'} tracked
                  {source.unknown_file_count ? `, ${source.unknown_file_count} unknown` : ''}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400">
              Older files may show as unknown until metadata is backfilled.
            </p>
            <button
              type="button"
              disabled={!unknownFileCount || backfillMut.isPending}
              onClick={() => backfillMut.mutate({ limit: 50 })}
              className="shrink-0 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:opacity-40"
            >
              {backfillMut.isPending ? 'Backfilling...' : 'Backfill sizes'}
            </button>
          </div>
          {backfillMut.data && (
            <p className="mt-2 text-xs text-gray-500">
              Backfilled {backfillMut.data.updated} file row{backfillMut.data.updated === 1 ? '' : 's'}
              {backfillMut.data.failed ? `, ${backfillMut.data.failed} failed` : ''}.
            </p>
          )}
          {backfillMut.isError && (
            <p className="mt-2 text-xs text-red-500">Backfill failed. Check the backend logs and storage credentials.</p>
          )}
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

export const SENT_SUBMISSION_BATCH_STORAGE_KEY = 'financeClaims.sentSubmissionBatch'

function defaultStorage() {
  return typeof window === 'undefined' ? null : window.localStorage
}

function uniqueIds(ids = []) {
  const seen = new Set()
  const result = []
  for (const id of ids) {
    const value = String(id || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

export function buildSentSubmissionBatch({
  existingBatch = null,
  selectedClaimIds = [],
  skippedClaimIds = [],
  now = new Date().toISOString(),
} = {}) {
  const skipped = new Set(uniqueIds(skippedClaimIds))
  const sentIds = uniqueIds(selectedClaimIds).filter((id) => !skipped.has(id))
  const existingIds = uniqueIds(existingBatch?.claimIds)
  const mergedIds = uniqueIds([...existingIds, ...sentIds])

  if (mergedIds.length === 0) return null
  if (sentIds.length === 0 && existingBatch) return {
    claimIds: existingIds,
    createdAt: existingBatch.createdAt,
    updatedAt: existingBatch.updatedAt,
  }

  return {
    claimIds: mergedIds,
    createdAt: existingBatch?.createdAt || now,
    updatedAt: now,
  }
}

export function removeClaimIdsFromBatch(batch, claimIds = []) {
  const submitted = new Set(uniqueIds(claimIds))
  const remaining = uniqueIds(batch?.claimIds).filter((id) => !submitted.has(id))
  if (remaining.length === 0) return null
  return {
    claimIds: remaining,
    createdAt: batch.createdAt,
    updatedAt: new Date().toISOString(),
  }
}

export function readSentSubmissionBatch(storage = defaultStorage()) {
  try {
    if (!storage) return null
    const raw = storage.getItem(SENT_SUBMISSION_BATCH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const claimIds = uniqueIds(parsed?.claimIds)
    if (claimIds.length === 0) return null
    return {
      claimIds,
      createdAt: parsed.createdAt || parsed.updatedAt || new Date().toISOString(),
      updatedAt: parsed.updatedAt || parsed.createdAt || new Date().toISOString(),
    }
  } catch {
    return null
  }
}

export function writeSentSubmissionBatch(batch, storage = defaultStorage()) {
  if (!storage) return null
  if (!batch || uniqueIds(batch.claimIds).length === 0) {
    storage.removeItem(SENT_SUBMISSION_BATCH_STORAGE_KEY)
    return null
  }
  const cleanBatch = {
    claimIds: uniqueIds(batch.claimIds),
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  }
  storage.setItem(SENT_SUBMISSION_BATCH_STORAGE_KEY, JSON.stringify(cleanBatch))
  return cleanBatch
}

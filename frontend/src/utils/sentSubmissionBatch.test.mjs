import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSentSubmissionBatch,
  readSentSubmissionBatch,
  removeClaimIdsFromBatch,
  writeSentSubmissionBatch,
} from './sentSubmissionBatch.js'

test('builds a pending submitted batch from successfully sent claims only', () => {
  const batch = buildSentSubmissionBatch({
    existingBatch: null,
    selectedClaimIds: ['claim-1', 'claim-2', 'claim-3'],
    skippedClaimIds: ['claim-2'],
    now: '2026-05-16T10:00:00.000Z',
  })

  assert.deepEqual(batch, {
    claimIds: ['claim-1', 'claim-3'],
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
  })
})

test('merges later sent claims into the existing pending batch without duplicates', () => {
  const batch = buildSentSubmissionBatch({
    existingBatch: {
      claimIds: ['claim-1', 'claim-2'],
      createdAt: '2026-05-16T10:00:00.000Z',
      updatedAt: '2026-05-16T10:00:00.000Z',
    },
    selectedClaimIds: ['claim-2', 'claim-3'],
    skippedClaimIds: [],
    now: '2026-05-16T10:15:00.000Z',
  })

  assert.deepEqual(batch, {
    claimIds: ['claim-1', 'claim-2', 'claim-3'],
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:15:00.000Z',
  })
})

test('keeps the existing batch when every selected claim was skipped', () => {
  const existingBatch = {
    claimIds: ['claim-1'],
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:00:00.000Z',
  }

  const batch = buildSentSubmissionBatch({
    existingBatch,
    selectedClaimIds: ['claim-2'],
    skippedClaimIds: ['claim-2'],
    now: '2026-05-16T10:15:00.000Z',
  })

  assert.deepEqual(batch, existingBatch)
})

test('removes submitted claim IDs and clears an empty batch', () => {
  assert.equal(
    removeClaimIdsFromBatch(
      {
        claimIds: ['claim-1', 'claim-2'],
        createdAt: '2026-05-16T10:00:00.000Z',
        updatedAt: '2026-05-16T10:00:00.000Z',
      },
      ['claim-1', 'claim-2'],
    ),
    null,
  )
})

test('read returns null when browser storage is unavailable', () => {
  assert.equal(readSentSubmissionBatch(), null)
})

test('writes and reads a pending batch from supplied storage', () => {
  const store = new Map()
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  }

  writeSentSubmissionBatch({
    claimIds: ['claim-1', 'claim-1', 'claim-2'],
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:15:00.000Z',
  }, storage)

  assert.deepEqual(readSentSubmissionBatch(storage), {
    claimIds: ['claim-1', 'claim-2'],
    createdAt: '2026-05-16T10:00:00.000Z',
    updatedAt: '2026-05-16T10:15:00.000Z',
  })
})

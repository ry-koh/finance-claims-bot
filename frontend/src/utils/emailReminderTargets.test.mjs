import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEmailReminderTargets,
  countSelectedReminderClaims,
} from './emailReminderTargets.js'

test('groups waiting email reminders by treasurer and skips non-waiting claims', () => {
  const targets = buildEmailReminderTargets([
    {
      id: 'claim-1',
      status: 'email_sent',
      filled_by: 'treasurer-1',
      claimer: { id: 'treasurer-1', name: 'Alicia Tan' },
    },
    {
      id: 'claim-2',
      status: 'screenshot_pending',
      filled_by: 'treasurer-1',
      claimer: { id: 'treasurer-1', name: 'Alicia Tan' },
    },
    {
      id: 'claim-3',
      status: 'pending_review',
      filled_by: 'treasurer-2',
      claimer: { id: 'treasurer-2', name: 'Bryan Ong' },
    },
    {
      id: 'claim-4',
      status: 'email_sent',
      filled_by: null,
      claimer: { id: 'treasurer-3', name: 'No Filled By' },
    },
  ])

  assert.deepEqual(targets, [
    {
      treasurerId: 'treasurer-1',
      name: 'Alicia Tan',
      claimCount: 2,
      claims: ['claim-1', 'claim-2'],
    },
  ])
})

test('counts claims covered by selected treasurers', () => {
  const targets = [
    { treasurerId: 'treasurer-1', claimCount: 2 },
    { treasurerId: 'treasurer-2', claimCount: 1 },
  ]

  assert.equal(countSelectedReminderClaims(targets, new Set(['treasurer-1'])), 2)
})

test('uses the filled-by member name for the bump target', () => {
  const targets = buildEmailReminderTargets([
    {
      id: 'claim-1',
      status: 'email_sent',
      filled_by: 'treasurer-1',
      filled_by_member: { id: 'treasurer-1', name: 'Actual Treasurer' },
      claimer: { id: 'treasurer-2', name: 'Claim Owner' },
    },
  ])

  assert.equal(targets[0].name, 'Actual Treasurer')
})

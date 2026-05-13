import test from 'node:test'
import assert from 'node:assert/strict'

import {
  getTreasurerProgressMessage,
  getTreasurerStatusKey,
  getTreasurerStatusLabel,
} from './treasurerStatus.js'

test('treasurer sees email-sent claims as needing email action', () => {
  const claim = { status: 'email_sent' }

  assert.equal(getTreasurerStatusKey(claim), 'send_email')
  assert.equal(getTreasurerStatusLabel(claim), 'Send Email')
  assert.equal(
    getTreasurerProgressMessage(claim),
    'Finance approved this claim. Send the confirmation email.'
  )
  assert.doesNotMatch(getTreasurerProgressMessage(claim), /upload/i)
  assert.doesNotMatch(getTreasurerProgressMessage(claim), /screenshot/i)
})

test('treasurer sees screenshot-pending claims as needing email action', () => {
  const claim = { status: 'screenshot_pending' }

  assert.equal(getTreasurerStatusKey(claim), 'send_email')
})

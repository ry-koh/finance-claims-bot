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
    'Finance approved this claim. Send the email, then upload the sent-email screenshot.'
  )
})

test('treasurer sees screenshot-pending claims as needing email action', () => {
  const claim = { status: 'screenshot_pending' }

  assert.equal(getTreasurerStatusKey(claim), 'send_email')
})

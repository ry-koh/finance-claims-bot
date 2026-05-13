export const EMAIL_REMINDER_STATUS_VALUES = ['email_sent', 'screenshot_pending']

const EMAIL_REMINDER_STATUSES = new Set(EMAIL_REMINDER_STATUS_VALUES)

export function isEmailReminderClaim(claim) {
  return EMAIL_REMINDER_STATUSES.has(claim?.status)
}

export function buildEmailReminderTargets(claims = []) {
  const byTreasurer = new Map()

  for (const claim of claims) {
    if (!isEmailReminderClaim(claim)) continue
    const treasurerId = claim.filled_by ? String(claim.filled_by) : ''
    if (!treasurerId) continue

    const existing = byTreasurer.get(treasurerId) ?? {
      treasurerId,
      name: claim.filled_by_member?.name || claim.filled_by_name || claim.claimer?.name || 'Treasurer',
      claimCount: 0,
      claims: [],
    }
    existing.claimCount += 1
    existing.claims.push(claim.id)
    byTreasurer.set(treasurerId, existing)
  }

  return Array.from(byTreasurer.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export function countSelectedReminderClaims(targets = [], selectedTreasurerIds = new Set()) {
  return targets.reduce(
    (sum, target) => sum + (selectedTreasurerIds.has(target.treasurerId) ? target.claimCount : 0),
    0
  )
}

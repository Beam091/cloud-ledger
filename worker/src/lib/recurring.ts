// Date stepping for recurring transactions; dates are YYYY-MM-DD strings.
export type Frequency = 'daily' | 'weekly' | 'monthly'

export function isValidRecurringDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function advanceRecurringDate(dateString: string, frequency: Frequency, anchorDay?: number | null) {
  if (!isValidRecurringDate(dateString)) throw new Error(`invalid recurring date: ${dateString}`)
  const date = new Date(`${dateString}T00:00:00Z`)
  if (frequency === 'daily') date.setUTCDate(date.getUTCDate() + 1)
  else if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7)
  else {
    // Monthly: keep the same day of month, clamped to the month's real length
    const targetAnchor = (anchorDay !== undefined && anchorDay !== null && anchorDay >= 1 && anchorDay <= 31)
      ? anchorDay
      : date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + 1)
    const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
    date.setUTCDate(Math.min(targetAnchor, daysInMonth))
  }
  return date.toISOString().slice(0, 10)
}

export function isValidFrequency(value: unknown): value is Frequency {
  return value === 'daily' || value === 'weekly' || value === 'monthly'
}

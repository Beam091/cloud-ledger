function cronFieldMatches(field: string, value: number, min: number, max: number) {
  return field.split(',').some((part) => {
    const [range, stepText] = part.split('/')
    const step = stepText ? Number(stepText) : 1
    if (!Number.isInteger(step) || step < 1) return false
    let start = min
    let end = max
    if (range !== '*') {
      if (range.includes('-')) {
        const [rangeStart, rangeEnd] = range.split('-').map(Number)
        start = rangeStart
        end = rangeEnd
      } else {
        start = Number(range)
        end = stepText ? max : start
      }
    }
    return Number.isInteger(start) && Number.isInteger(end) && start >= min && end <= max && start <= end && value >= start && value <= end && (value - start) % step === 0
  })
}

// Standard 5-field cron support with the day-of-month / day-of-week OR rule
export function cronMatches(expression: string, date: Date, timezone: string) {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'Asia/Bangkok', minute: 'numeric', hour: 'numeric', hourCycle: 'h23', day: 'numeric', month: 'numeric', weekday: 'short' }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const minute = Number(values.minute)
  const hour = Number(values.hour)
  const day = Number(values.day)
  const month = Number(values.month)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)
  const dayMatches = cronFieldMatches(fields[2], day, 1, 31)
  const weekdayMatches = cronFieldMatches(fields[4], weekday, 0, 6)
  const dateMatches = fields[2] === '*' || fields[4] === '*' ? dayMatches && weekdayMatches : dayMatches || weekdayMatches
  return cronFieldMatches(fields[0], minute, 0, 59) && cronFieldMatches(fields[1], hour, 0, 23) && dateMatches && cronFieldMatches(fields[3], month, 1, 12)
}

function safeFormat(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
}

// YYYY-MM-DD of the current moment as seen in the target timezone
export function dateInTz(timezone: string, date = new Date()) {
  try {
    return safeFormat(timezone).format(date)
  } catch {
    return safeFormat('Asia/Bangkok').format(date)
  }
}

// Current offset ("+420" for UTC+7 etc.); defaults to Bangkok when the name is unknown
export function tzOffsetMinutes(timezone: string) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value || ''
    const match = name.match(/GMT([+-])(\d{2}):(\d{2})/)
    if (!match) return 420
    const sign = match[1] === '-' ? -1 : 1
    return sign * (Number(match[2]) * 60 + Number(match[3]))
  } catch { return 420 }
}

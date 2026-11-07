const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "5 min. ago", "3 hr. ago", "yesterday", then a short date after a week. */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(seconds)

  if (abs < MINUTE) return 'just now'
  if (abs < HOUR) return relative.format(Math.round(seconds / MINUTE), 'minute')
  if (abs < DAY) return relative.format(Math.round(seconds / HOUR), 'hour')
  if (abs < 7 * DAY) return relative.format(Math.round(seconds / DAY), 'day')
  return (date.getFullYear() === now.getFullYear() ? dayMonth : dayMonthYear).format(date)
}

/** Full date and time for the detail view, in the viewer's locale. */
export function formatFullDate(iso: string): string {
  return full.format(new Date(iso))
}

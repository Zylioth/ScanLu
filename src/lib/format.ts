/** Formatting helpers. Currency is BND, displayed as B$ 4.50 (design.md §7). */

/** Intl renders BND as "BND 4.50" or "$4.50" depending on the ICU build, so the
 *  symbol is pinned to keep every price identical across devices. */
export function formatMoney(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return `B$ ${rounded.toFixed(2)}`
}

const TZ = 'Asia/Brunei'

/** Calendar day key in Brunei time, used for per-day counters. */
export function dayKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** "just now", "3 min ago", "1 h 12 min ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem === 0 ? `${hours} h ago` : `${hours} h ${rem} min ago`
}

/** Elapsed minutes since an ISO timestamp, floored. */
export function minutesSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
}

/** "0:42" style age timer for the admin board. */
export function ageTimer(iso: string, now: number = Date.now()): string {
  const total = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export function minutesUntil(iso: string | null, now: number = Date.now()): number {
  if (!iso) return 0
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60000))
}

export function secondsSince(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
}

/** 1 becomes "A-001", 1000 becomes "B-001": the letter rolls every 999. */
export function displayNumberFor(orderNumber: number): string {
  const letter = String.fromCharCode(65 + Math.floor((orderNumber - 1) / 999))
  const within = ((orderNumber - 1) % 999) + 1
  return `${letter}-${String(within).padStart(3, '0')}`
}

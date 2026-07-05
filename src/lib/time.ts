/** Formats a UTC ISO timestamp as `YYYY-MM-DD HH:MMZ`. */
export function formatZulu(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')}Z`
}

/**
 * The calendar date (`YYYY-MM-DD`) at the given timezone for a UTC ISO timestamp — so a late-night
 * departure isn't shown as the next day's UTC date. Falls back to the UTC date if tz is unknown.
 */
export function localDate(iso: string, tz: string | null | undefined): string {
  if (!tz) return iso.slice(0, 10)
  try {
    // en-CA renders as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

/**
 * Formats a UTC ISO timestamp in an airport's local time. `Intl` applies the correct UTC offset
 * for that specific date, so DST is handled automatically (e.g. EST vs EDT). Returns null when the
 * timezone is unknown.
 */
export function formatLocal(iso: string, tz: string | null | undefined): string | null {
  if (!tz) return null
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).format(new Date(iso))
  } catch {
    return null
  }
}

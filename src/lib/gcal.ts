/**
 * Google Calendar read-only overlay for the tasks calendar.
 *
 * Uses Google Identity Services (GIS) token flow — no backend needed. The
 * browser access token lasts ~1 hour and cannot be silently refreshed in a
 * pure client app, so the user reconnects once per session. The OAuth client
 * id is public (safe to store); no client secret is involved.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client'
// readonly powers the tasks overlay; events lets us push reminders to the calendar.
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGoogle = any

let accessToken: string | null = null
let tokenExpiry = 0

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function loadGsi(): Promise<void> {
  const w = window as unknown as { google?: AnyGoogle }
  if (w.google?.accounts?.oauth2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GSI_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google')))
      return
    }
    const s = document.createElement('script')
    s.src = GSI_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
}

export function isGcalConnected(): boolean {
  return !!accessToken && Date.now() < tokenExpiry - 30_000
}

/** Prompt the Google account chooser / consent and cache a token (user gesture required). */
export async function connectGcal(clientId: string): Promise<void> {
  await loadGsi()
  const w = window as unknown as { google: AnyGoogle }
  return new Promise((resolve, reject) => {
    const client = w.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => {
        if (resp.error || !resp.access_token) return reject(new Error(resp.error ?? 'Authorisation failed'))
        accessToken = resp.access_token
        tokenExpiry = Date.now() + (resp.expires_in ?? 3600) * 1000
        resolve()
      }
    })
    client.requestAccessToken({ prompt: accessToken ? '' : 'consent' })
  })
}

export function disconnectGcal(): void {
  accessToken = null
  tokenExpiry = 0
}

export interface GcalEvent {
  id: string
  title: string
  /** ISO date YYYY-MM-DD */
  date: string
  /** HH:MM for timed events */
  time?: string
  allDay: boolean
}

/** Fetch primary-calendar events in [fromISO, toISO]. Requires an active connection. */
export async function fetchEvents(fromISO: string, toISO: string): Promise<GcalEvent[]> {
  if (!isGcalConnected()) throw new Error('not-connected')
  const params = new URLSearchParams({
    timeMin: new Date(`${fromISO}T00:00:00`).toISOString(),
    timeMax: new Date(`${toISO}T23:59:59`).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250'
  })
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (res.status === 401) {
    disconnectGcal()
    throw new Error('not-connected')
  }
  if (!res.ok) throw new Error(`Google Calendar error ${res.status}`)
  const data = (await res.json()) as {
    items?: { id: string; summary?: string; start?: { date?: string; dateTime?: string } }[]
  }
  return (data.items ?? []).map(e => {
    const allDay = !e.start?.dateTime
    const date = allDay ? (e.start?.date ?? '') : localDate(new Date(e.start!.dateTime!))
    const time = allDay ? undefined : (() => {
      const d = new Date(e.start!.dateTime!)
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`
    })()
    return { id: e.id, title: e.summary ?? '(no title)', date, time, allDay }
  })
}

function nextDayISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return localDate(d)
}

/**
 * Create a Google Calendar event so iOS/Android fire a native reminder.
 * Returns the created event id. Requires an active connection (user gesture).
 */
export async function createEvent(ev: {
  title: string
  /** ISO date YYYY-MM-DD */
  date: string
  /** HH:MM (24h); omit for an all-day reminder */
  time?: string
  note?: string
  /** popup minutes before the start (timed events only) */
  reminderMinutes?: number
}): Promise<string> {
  if (!isGcalConnected()) throw new Error('not-connected')
  const body: Record<string, unknown> = {
    summary: ev.title,
    ...(ev.note ? { description: ev.note } : {})
  }
  if (ev.time) {
    const start = new Date(`${ev.date}T${ev.time}:00`)
    const end = new Date(start.getTime() + 60 * 60_000)
    body.start = { dateTime: start.toISOString() }
    body.end = { dateTime: end.toISOString() }
    body.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: ev.reminderMinutes ?? 30 }] }
  } else {
    // All-day: let the calendar's default all-day reminder handle notification timing.
    body.start = { date: ev.date }
    body.end = { date: nextDayISO(ev.date) }
    body.reminders = { useDefault: true }
  }
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (res.status === 401) {
    disconnectGcal()
    throw new Error('not-connected')
  }
  if (!res.ok) throw new Error(`Google Calendar error ${res.status}`)
  const data = (await res.json()) as { id: string }
  return data.id
}

/** Best-effort delete of a previously created event (ignores 404/410). */
export async function deleteEvent(eventId: string): Promise<void> {
  if (!isGcalConnected()) throw new Error('not-connected')
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` }
  })
  if (res.status === 401) {
    disconnectGcal()
    throw new Error('not-connected')
  }
  if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google Calendar error ${res.status}`)
}

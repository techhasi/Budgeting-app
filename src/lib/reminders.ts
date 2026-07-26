/**
 * Reminders: dated nudges shown in-app and optionally mirrored to Google
 * Calendar (the reliable way to get a native lock-screen alert on iPhone,
 * which a home-screen PWA can't fire on its own).
 */

import { db, uid, type Reminder, type ReminderSource } from '../db/db'
import { connectGcal, createEvent, deleteEvent, isGcalConnected } from './gcal'

/** Ensure a Google session, connecting with `clientId` if needed (user gesture). */
export async function ensureGcal(clientId?: string): Promise<boolean> {
  if (isGcalConnected()) return true
  if (!clientId) return false
  try {
    await connectGcal(clientId)
    return true
  } catch {
    return false
  }
}

export interface NewReminder {
  title: string
  /** ISO date YYYY-MM-DD */
  date: string
  time?: string
  note?: string
  source: ReminderSource
  refId?: string
}

/** Create a reminder; optionally mirror to Google Calendar for a native alert. */
export async function addReminder(
  r: NewReminder,
  opts?: { pushToCalendar?: boolean; clientId?: string }
): Promise<{ reminder: Reminder; calendarPushed: boolean }> {
  const reminder: Reminder = { id: uid(), done: false, createdAt: Date.now(), ...r }
  let calendarPushed = false
  if (opts?.pushToCalendar) {
    try {
      if (await ensureGcal(opts.clientId)) {
        reminder.gcalEventId = await createEvent({
          title: r.title,
          date: r.date,
          time: r.time,
          note: r.note
        })
        calendarPushed = true
      }
    } catch {
      // Keep the in-app reminder even if the calendar push fails.
    }
  }
  await db.reminders.add(reminder)
  return { reminder, calendarPushed }
}

/** Remove a reminder and its calendar event (best-effort). */
export async function deleteReminder(r: Reminder): Promise<void> {
  if (r.gcalEventId) {
    try {
      await deleteEvent(r.gcalEventId)
    } catch {
      // ignore — the event may already be gone or we're offline
    }
  }
  await db.reminders.delete(r.id)
}

export async function toggleReminderDone(r: Reminder): Promise<void> {
  await db.reminders.update(r.id, { done: !r.done })
}

/** Not-done reminders due on or before `today`, soonest first (in-app badge). */
export function dueReminders(reminders: Reminder[], today: string): Reminder[] {
  return reminders.filter(r => !r.done && r.date <= today).sort((a, b) => a.date.localeCompare(b.date))
}

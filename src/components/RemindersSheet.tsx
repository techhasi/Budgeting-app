import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Reminder } from '../db/db'
import { addReminder, deleteReminder, toggleReminderDone } from '../lib/reminders'
import { friendlyDate, todayISO, daysUntil } from '../lib/dates'
import Sheet from './Sheet'

const inputCls =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60'

export default function RemindersSheet({ onClose }: { onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const reminders = useLiveQuery(() => db.reminders.orderBy('date').toArray(), [], [])

  const hasGcal = !!settings?.gcalClientId
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayISO())
  const [time, setTime] = useState('')
  const [toCalendar, setToCalendar] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function add() {
    if (!title.trim()) return setMsg('Enter a reminder')
    setBusy(true)
    setMsg('')
    const { calendarPushed } = await addReminder(
      { title: title.trim(), date, time: time || undefined, source: 'manual' },
      { pushToCalendar: hasGcal && toCalendar, clientId: settings?.gcalClientId }
    )
    setBusy(false)
    setTitle('')
    setTime('')
    if (hasGcal && toCalendar && !calendarPushed) setMsg('Saved in-app — Google Calendar push failed (reconnect in Settings).')
    else if (calendarPushed) setMsg('✅ Added + pushed to Google Calendar')
  }

  const active = reminders.filter(r => !r.done)
  const done = reminders.filter(r => r.done)

  return (
    <Sheet onClose={onClose} title="Reminders">
      <input autoFocus placeholder="Reminder (e.g. Pay rent, FD renewal)" value={title} onChange={e => setTitle(e.target.value)} className={`mb-2 ${inputCls}`} />
      <div className="mb-2 grid grid-cols-2 gap-2">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        <input type="time" value={time} onChange={e => setTime(e.target.value)} className={inputCls} />
      </div>
      <label className={`mb-2 flex items-center justify-between rounded-2xl p-3 ${hasGcal ? 'bg-slate-50 dark:bg-slate-800/60' : 'bg-slate-50 opacity-60 dark:bg-slate-800/60'}`}>
        <span className="text-sm font-medium">📅 Also add to Google Calendar</span>
        <input type="checkbox" checked={hasGcal && toCalendar} disabled={!hasGcal} onChange={e => setToCalendar(e.target.checked)} className="h-5 w-5 accent-indigo-500" />
      </label>
      {!hasGcal && <p className="mb-2 text-xs text-slate-400">Connect Google Calendar in Settings to get native iPhone alerts; reminders stay in-app otherwise.</p>}
      <button onClick={add} disabled={busy} className="mb-2 w-full rounded-2xl bg-indigo-500 py-3 font-bold text-white shadow-lg shadow-indigo-500/30 disabled:opacity-50">
        {busy ? 'Adding…' : '+ Add reminder'}
      </button>
      {msg && <p className="mb-3 text-center text-xs font-medium text-slate-500 dark:text-slate-400">{msg}</p>}

      <div className="mt-3 space-y-2">
        {active.length === 0 && done.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
            No reminders yet. FD maturities you opt into show up here too.
          </p>
        )}
        {active.map(r => (
          <ReminderRow key={r.id} r={r} />
        ))}
        {done.length > 0 && (
          <>
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Done</p>
            {done.map(r => (
              <ReminderRow key={r.id} r={r} />
            ))}
          </>
        )}
      </div>
    </Sheet>
  )
}

function ReminderRow({ r }: { r: Reminder }) {
  const overdue = !r.done && r.date < todayISO()
  const days = daysUntil(r.date)
  const when = r.done
    ? friendlyDate(r.date)
    : overdue
      ? `overdue · ${friendlyDate(r.date).toLowerCase()}`
      : days === 0
        ? 'today'
        : days === 1
          ? 'tomorrow'
          : friendlyDate(r.date)
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-800/60">
      <button
        onClick={() => toggleReminderDone(r)}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs ${
          r.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'
        }`}
      >
        {r.done ? '✓' : ''}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${r.done ? 'text-slate-400 line-through' : ''}`}>
          {r.source === 'fd' ? '🏦 ' : ''}
          {r.title}
        </p>
        <p className={`text-xs ${overdue ? 'font-semibold text-rose-500' : 'text-slate-400'}`}>
          {when}
          {r.time ? ` · ${r.time}` : ''}
          {r.gcalEventId ? ' · 📅' : ''}
        </p>
      </div>
      <button onClick={() => deleteReminder(r)} className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-400 active:bg-slate-100 dark:active:bg-slate-700">
        ✕
      </button>
    </div>
  )
}

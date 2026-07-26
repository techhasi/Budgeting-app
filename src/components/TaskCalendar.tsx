import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Task } from '../db/db'
import { todayISO } from '../lib/dates'
import { toggleTask } from '../lib/tasks'
import { fetchEvents, isGcalConnected, connectGcal, type GcalEvent } from '../lib/gcal'
import { gcalClientId } from '../lib/env'
import TaskRow from './TaskRow'
import TaskSheet from './TaskSheet'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function pad(n: number) {
  return String(n).padStart(2, '0')
}

/** 6x7 grid of ISO dates covering the month of (year, month0). */
function monthGrid(year: number, month0: number): string[] {
  const first = new Date(year, month0, 1)
  const start = new Date(year, month0, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
}

export default function TaskCalendar() {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], [])
  const lists = useLiveQuery(() => db.taskLists.toArray(), [], [])

  const today = todayISO()
  const [cursor, setCursor] = useState(() => {
    const d = new Date()
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const [selected, setSelected] = useState(today)
  const [events, setEvents] = useState<GcalEvent[]>([])
  const [gcalMsg, setGcalMsg] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const [adding, setAdding] = useState(false)

  const grid = useMemo(() => monthGrid(cursor.y, cursor.m), [cursor])
  const listColor = useMemo(() => new Map(lists.map(l => [l.id, l.color])), [lists])

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.dueDate) continue
      const arr = map.get(t.dueDate) ?? []
      arr.push(t)
      map.set(t.dueDate, arr)
    }
    return map
  }, [tasks])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, GcalEvent[]>()
    for (const e of events) {
      const arr = map.get(e.date) ?? []
      arr.push(e)
      map.set(e.date, arr)
    }
    return map
  }, [events])

  // Load Google events for the visible month when connected
  const clientId = gcalClientId(settings)
  useEffect(() => {
    if (!clientId || !isGcalConnected()) return
    fetchEvents(grid[0], grid[41])
      .then(setEvents)
      .catch(() => setGcalMsg('Google session expired — reconnect'))
  }, [clientId, grid])

  async function connectAndLoad() {
    if (!clientId) return setGcalMsg('Add a Google client id in Settings first')
    setGcalMsg('Connecting…')
    try {
      await connectGcal(clientId)
      setEvents(await fetchEvents(grid[0], grid[41]))
      setGcalMsg('')
    } catch (e) {
      setGcalMsg(e instanceof Error && e.message !== 'not-connected' ? e.message : 'Could not connect to Google')
    }
  }

  const selectedTasks = tasksByDay.get(selected) ?? []
  const selectedEvents = eventsByDay.get(selected) ?? []

  return (
    <div>
      {/* Month header */}
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => setCursor(c => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}
          className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-800"
        >
          ‹
        </button>
        <p className="text-sm font-bold">{MONTHS[cursor.m]} {cursor.y}</p>
        <button
          onClick={() => setCursor(c => ({ y: c.m === 11 ? c.y + 1 : c.y, m: c.m === 11 ? 0 : c.m + 1 }))}
          className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm dark:bg-slate-800"
        >
          ›
        </button>
      </div>

      {/* Grid */}
      <div className="rounded-2xl bg-white p-2 shadow-sm dark:bg-slate-800/60">
        <div className="mb-1 grid grid-cols-7">
          {WEEKDAYS.map((d, i) => (
            <div key={i} className="py-1 text-center text-[10px] font-semibold text-slate-400">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {grid.map(iso => {
            const inMonth = Number(iso.slice(5, 7)) === cursor.m + 1
            const dayTasks = tasksByDay.get(iso) ?? []
            const dayEvents = eventsByDay.get(iso) ?? []
            const dots = [
              ...dayTasks.slice(0, 3).map(t => (t.done ? '#94a3b8' : (t.listId && listColor.get(t.listId)) || '#6366f1')),
              ...(dayEvents.length ? ['#22c55e'] : [])
            ].slice(0, 4)
            return (
              <button
                key={iso}
                onClick={() => setSelected(iso)}
                className={`flex aspect-square flex-col items-center justify-start rounded-lg pt-1 ${
                  selected === iso ? 'bg-indigo-500 text-white' : iso === today ? 'bg-indigo-50 dark:bg-indigo-500/10' : ''
                } ${inMonth ? '' : 'opacity-30'}`}
              >
                <span className={`text-xs ${iso === today && selected !== iso ? 'font-bold text-indigo-500' : ''}`}>
                  {Number(iso.slice(8, 10))}
                </span>
                <span className="mt-0.5 flex gap-0.5">
                  {dots.map((c, i) => (
                    <span key={i} className="h-1 w-1 rounded-full" style={{ backgroundColor: selected === iso ? '#fff' : c }} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Google Calendar connect */}
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-white px-4 py-2.5 shadow-sm dark:bg-slate-800/60">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          📅 {isGcalConnected() ? 'Google Calendar connected' : gcalMsg || 'Overlay your Google Calendar'}
        </span>
        <button onClick={connectAndLoad} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white">
          {isGcalConnected() ? 'Refresh' : 'Connect'}
        </button>
      </div>

      {/* Selected day agenda */}
      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{new Date(selected + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
        <button onClick={() => setAdding(true)} className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white">+ Task</button>
      </div>

      {selectedEvents.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {selectedEvents.map(e => (
            <div key={e.id} className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-500/10">
              <span>📅</span>
              <span className="flex-1 truncate">{e.title}</span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400">{e.allDay ? 'All day' : e.time}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 space-y-2">
        {selectedTasks.length === 0 && selectedEvents.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400 dark:border-slate-700">
            Nothing scheduled.
          </p>
        )}
        {selectedTasks.map(t => (
          <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t)} onOpen={() => setEditing(t)} />
        ))}
      </div>

      {editing && <TaskSheet edit={editing} onClose={() => setEditing(null)} />}
      {adding && <TaskSheet defaultDate={selected} onClose={() => setAdding(false)} />}
    </div>
  )
}

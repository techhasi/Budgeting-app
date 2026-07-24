import { db, uid, type Recurring } from '../db/db'
import { todayISO } from './dates'

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Advance a due date by the interval, keeping dayOfMonth clamped to month length. */
export function advanceDue(current: string, dayOfMonth: number, intervalMonths: number): string {
  const [y, m] = current.split('-').map(Number)
  const monthIndex = m - 1 + intervalMonths
  const year = y + Math.floor(monthIndex / 12)
  const month = monthIndex % 12
  const lastDay = new Date(year, month + 1, 0).getDate()
  return iso(year, month + 1, Math.min(dayOfMonth, lastDay))
}

/** First due date on/after today for a given day of month. */
export function firstDue(dayOfMonth: number): string {
  const now = new Date()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const candidate = iso(now.getFullYear(), now.getMonth() + 1, Math.min(dayOfMonth, lastDay))
  return candidate >= todayISO() ? candidate : advanceDue(candidate, dayOfMonth, 1)
}

/** Log the due occurrence as a transaction and advance the schedule. */
export async function logRecurring(r: Recurring): Promise<void> {
  await db.transaction('rw', [db.txns, db.recurring], async () => {
    await db.txns.add({
      id: uid(),
      type: 'expense',
      amountMinor: r.amountMinor,
      currency: r.currency,
      categoryId: r.categoryId,
      accountId: r.accountId,
      date: r.nextDue <= todayISO() ? r.nextDue : todayISO(),
      note: r.note ? `${r.name} · ${r.note}` : r.name,
      createdAt: Date.now()
    })
    const patch: Partial<Recurring> = { nextDue: advanceDue(r.nextDue, r.dayOfMonth, r.intervalMonths) }
    if (r.kind === 'loan') patch.paidMinor = (r.paidMinor ?? 0) + r.amountMinor
    await db.recurring.update(r.id, patch)
  })
}

/** Skip this occurrence without logging a transaction. */
export async function skipRecurring(r: Recurring): Promise<void> {
  await db.recurring.update(r.id, { nextDue: advanceDue(r.nextDue, r.dayOfMonth, r.intervalMonths) })
}

export function loanRemaining(r: Recurring): number {
  return Math.max(0, (r.principalMinor ?? 0) - (r.paidMinor ?? 0))
}

/** Sum of outstanding loan balances per account (e.g. installment plans on a card). */
export function loanRemainingByAccount(recs: Recurring[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of recs) {
    if (r.kind !== 'loan') continue
    map.set(r.accountId, (map.get(r.accountId) ?? 0) + loanRemaining(r))
  }
  return map
}

/** This month's installment total per account, capped at each loan's remaining. */
export function loanInstallmentByAccount(recs: Recurring[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of recs) {
    if (r.kind !== 'loan') continue
    const inst = Math.min(r.amountMinor, loanRemaining(r))
    if (inst > 0) map.set(r.accountId, (map.get(r.accountId) ?? 0) + inst)
  }
  return map
}

/**
 * When a credit card bill is paid, advance every installment loan on that card:
 * one installment is now paid, so its remaining drops and its schedule rolls on.
 */
export async function payCardAdvanceLoans(accountId: string): Promise<void> {
  const loans = (await db.recurring.toArray()).filter(
    r => r.kind === 'loan' && r.accountId === accountId && loanRemaining(r) > 0
  )
  for (const r of loans) {
    const inst = Math.min(r.amountMinor, loanRemaining(r))
    await db.recurring.update(r.id, {
      paidMinor: (r.paidMinor ?? 0) + inst,
      nextDue: advanceDue(r.nextDue, r.dayOfMonth, r.intervalMonths)
    })
  }
}

/** Settle a loan's full remaining amount early as a single expense. */
export async function payOffLoan(r: Recurring): Promise<void> {
  const remaining = loanRemaining(r)
  if (remaining <= 0) return
  await db.transaction('rw', [db.txns, db.recurring], async () => {
    await db.txns.add({
      id: uid(),
      type: 'expense',
      amountMinor: remaining,
      currency: r.currency,
      categoryId: r.categoryId,
      accountId: r.accountId,
      date: todayISO(),
      note: `${r.name} · full settlement`,
      createdAt: Date.now()
    })
    await db.recurring.update(r.id, { paidMinor: r.principalMinor })
  })
}

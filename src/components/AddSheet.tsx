import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, DEFAULT_SETTINGS, type Currency, type Txn, type TxnType } from '../db/db'
import { parseAmount, CURRENCY_SYMBOL, fmt } from '../lib/money'
import { todayISO, addDaysISO, friendlyDate } from '../lib/dates'
import { compressImage } from '../lib/image'
import { startNewPeriod } from '../lib/periods'
import Sheet from './Sheet'

const CATEGORY_COLORS = ['#f97316', '#eab308', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#64748b']

export interface AddInitial {
  type?: TxnType
  amount?: string
  currency?: Currency
  date?: string
  note?: string
  accountId?: string
  toAccountId?: string
}

const TYPE_META: Record<TxnType, { label: string; active: string; button: string; saveLabel: string }> = {
  expense: {
    label: '↑ Expense',
    active: 'bg-rose-500 text-white shadow-md shadow-rose-500/30',
    button: 'bg-gradient-to-r from-rose-500 to-orange-500 shadow-rose-500/30',
    saveLabel: 'Add Expense'
  },
  income: {
    label: '↓ Income',
    active: 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30',
    button: 'bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-500/30',
    saveLabel: 'Add Income'
  },
  transfer: {
    label: '⇄ Transfer',
    active: 'bg-sky-500 text-white shadow-md shadow-sky-500/30',
    button: 'bg-gradient-to-r from-sky-500 to-indigo-500 shadow-sky-500/30',
    saveLabel: 'Add Transfer'
  }
}

export default function AddSheet({
  onClose,
  initial,
  edit,
  onSaved
}: {
  onClose: () => void
  initial?: AddInitial
  /** when set, the sheet edits this existing transaction instead of adding */
  edit?: Txn
  onSaved?: (saved: Txn) => void
}) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const existingReceipt = useLiveQuery(() => (edit ? db.receipts.get(edit.id) : undefined), [edit?.id])

  const [type, setType] = useState<TxnType>(edit?.type ?? initial?.type ?? 'expense')
  const [amount, setAmount] = useState(edit ? (edit.amountMinor / 100).toFixed(2) : (initial?.amount ?? ''))
  const [currency, setCurrency] = useState<Currency | null>(edit?.currency ?? initial?.currency ?? null)
  const [categoryId, setCategoryId] = useState<string | null>(edit?.categoryId || null)
  const [accountId, setAccountId] = useState<string | null>(edit?.accountId ?? initial?.accountId ?? null)
  const [toAccountId, setToAccountId] = useState<string | null>(edit?.toAccountId ?? initial?.toAccountId ?? null)
  const [date, setDate] = useState(edit?.date ?? initial?.date ?? todayISO())
  const [note, setNote] = useState(edit?.note ?? initial?.note ?? '')
  const [receipt, setReceipt] = useState<File | null>(null)
  const [startsPeriod, setStartsPeriod] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState<Txn | null>(null)
  const [received, setReceived] = useState(edit?.toAmountMinor ? (edit.toAmountMinor / 100).toFixed(2) : '')

  // New-category mini form
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatEmoji, setNewCatEmoji] = useState('✨')
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[5])

  const fileRef = useRef<HTMLInputElement>(null)

  const cats = useMemo(() => categories.filter(c => c.kind === type), [categories, type])
  const selectedCat = cats.find(c => c.id === categoryId)
  // Fall back to the configured primary account for the current type
  const preferredDefault = type === 'income' ? settings?.defaultIncomeAccountId : settings?.defaultExpenseAccountId
  const validPreferred = preferredDefault && accounts.some(a => a.id === preferredDefault) ? preferredDefault : undefined
  const effectiveAccountId = accountId ?? validPreferred ?? accounts[0]?.id ?? null
  const effectiveToAccountId = toAccountId ?? accounts.find(a => a.id !== effectiveAccountId)?.id ?? null
  const fromCur = accounts.find(a => a.id === effectiveAccountId)?.currency ?? 'LKR'
  const toCur = accounts.find(a => a.id === effectiveToAccountId)?.currency ?? 'LKR'
  const crossCurrency = type === 'transfer' && fromCur !== toCur
  // Transfers are denominated in the source account's currency
  const activeCurrency = type === 'transfer' ? fromCur : (currency ?? settings?.currency ?? 'LKR')
  // Only offer "start new period" for freshly added salary income
  const isSalary = !edit && type === 'income' && selectedCat?.name === 'Salary'

  async function addCategory() {
    const name = newCatName.trim()
    if (!name || type === 'transfer') return
    const id = uid()
    await db.categories.add({ id, name, emoji: newCatEmoji || '✨', color: newCatColor, kind: type })
    setCategoryId(id)
    setNewCatOpen(false)
    setNewCatName('')
  }

  async function save() {
    const amountMinor = parseAmount(amount)
    if (!amountMinor) return setError('Enter a valid amount')
    if (!effectiveAccountId) return setError('Pick an account')
    let toAmountMinor: number | undefined
    if (type === 'transfer') {
      if (accounts.length < 2) return setError('Add a second account first (Accounts tab)')
      if (!effectiveToAccountId || effectiveToAccountId === effectiveAccountId) return setError('Pick two different accounts')
      if (crossCurrency) {
        toAmountMinor = parseAmount(received) ?? undefined
        if (!toAmountMinor) return setError(`Enter the amount received in ${toCur}`)
      } else {
        toAmountMinor = amountMinor
      }
    } else if (!categoryId || !cats.some(c => c.id === categoryId)) {
      return setError('Pick a category')
    }
    setError('')

    // Duplicate check: same type + amount within ±2 days (skip when editing
    // or when the user already tapped "Add anyway")
    if (!edit && !duplicate) {
      const near = await db.txns
        .where('date')
        .between(addDaysISO(date, -2), addDaysISO(date, 2), true, true)
        .filter(t => t.type === type && t.amountMinor === amountMinor && t.currency === activeCurrency)
        .first()
      if (near) {
        setDuplicate(near)
        return
      }
    }
    setSaving(true)
    try {
      const fields = {
        type,
        amountMinor,
        currency: activeCurrency,
        categoryId: type === 'transfer' ? '' : categoryId!,
        accountId: effectiveAccountId,
        toAccountId: type === 'transfer' ? effectiveToAccountId! : undefined,
        toAmountMinor: type === 'transfer' ? toAmountMinor : undefined,
        date,
        note: note.trim()
      }

      let saved: Txn
      if (edit) {
        // Edits never re-trigger period changes; the original startsPeriod flag is kept.
        saved = { ...edit, ...fields }
        await db.txns.update(edit.id, fields)
      } else {
        const willStartPeriod = isSalary && startsPeriod
        if (willStartPeriod) await startNewPeriod(date)
        saved = { id: uid(), ...fields, startsPeriod: willStartPeriod || undefined, createdAt: Date.now() }
        await db.txns.add(saved)
      }

      if (type === 'expense' && receipt) {
        const blob = await compressImage(receipt)
        await db.receipts.put({ txnId: saved.id, blob })
      }
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
    }
  }

  const meta = TYPE_META[type]

  return (
    <Sheet onClose={onClose} title={edit ? 'Edit transaction' : null}>
      {/* Type toggle (fixed when editing — changing type would orphan category/accounts) */}
      {!edit && (
        <div className="mb-5 flex rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
          {(['expense', 'income', 'transfer'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setType(t); setCategoryId(null); setReceipt(null) }}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${
                type === t ? TYPE_META[t].active : 'text-slate-500'
              }`}
            >
              {TYPE_META[t].label}
            </button>
          ))}
        </div>
      )}

      {/* Amount */}
      {type === 'transfer' && <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-slate-400">Amount sent</p>}
      <div className="mb-5 flex items-end justify-center gap-2">
        {type === 'transfer' ? (
          <span className="mb-2 rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {CURRENCY_SYMBOL[fromCur]} {fromCur}
          </span>
        ) : (
          <button
            onClick={() => setCurrency(activeCurrency === 'LKR' ? 'USD' : 'LKR')}
            className="mb-2 rounded-lg bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          >
            {CURRENCY_SYMBOL[activeCurrency]} {activeCurrency}
          </button>
        )}
        <input
          autoFocus={!edit}
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={e => { setAmount(e.target.value); setDuplicate(null) }}
          className="w-44 bg-transparent text-center text-5xl font-bold tabular-nums tracking-tight outline-none placeholder:text-slate-300 dark:placeholder:text-slate-700"
        />
      </div>

      {crossCurrency && (
        <div className="mb-4 rounded-2xl bg-amber-50 p-3 dark:bg-amber-500/10">
          <Label>Amount received ({toCur})</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-500">{CURRENCY_SYMBOL[toCur]}</span>
            <input
              inputMode="decimal"
              placeholder="0.00"
              value={received}
              onChange={e => setReceived(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm tabular-nums dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
            Different currencies — enter exactly what landed in the destination account so both balances stay right.
          </p>
        </div>
      )}

      {type === 'transfer' ? (
        /* From / To accounts */
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <Label>From</Label>
            <select
              value={effectiveAccountId ?? ''}
              onChange={e => setAccountId(e.target.value)}
              className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>To</Label>
            <select
              value={effectiveToAccountId ?? ''}
              onChange={e => setToAccountId(e.target.value)}
              className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
            >
              {accounts.filter(a => a.id !== effectiveAccountId).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <>
          {/* Category */}
          <Label>Category</Label>
          <div className="mb-4 grid grid-cols-4 gap-2">
            {cats.map(c => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id)}
                className={`flex flex-col items-center gap-1 rounded-2xl border-2 p-2 transition-all ${
                  categoryId === c.id
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10'
                    : 'border-transparent bg-slate-50 dark:bg-slate-800/60'
                }`}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-xl text-base" style={{ backgroundColor: `${c.color}22` }}>
                  {c.emoji}
                </span>
                <span className="w-full truncate text-center text-[10px] font-medium">{c.name}</span>
              </button>
            ))}
            <button
              onClick={() => setNewCatOpen(o => !o)}
              className="flex flex-col items-center gap-1 rounded-2xl border-2 border-dashed border-slate-300 p-2 text-slate-400 dark:border-slate-600"
            >
              <span className="flex h-8 w-8 items-center justify-center text-lg">＋</span>
              <span className="text-[10px] font-medium">New</span>
            </button>
          </div>

          {newCatOpen && (
            <div className="mb-4 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
              <div className="mb-2 flex gap-2">
                <input
                  value={newCatEmoji}
                  onChange={e => setNewCatEmoji(e.target.value.slice(-2))}
                  className="w-12 rounded-xl border border-slate-200 bg-white p-2 text-center text-lg dark:border-slate-700 dark:bg-slate-900"
                />
                <input
                  placeholder="Category name"
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                />
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {CATEGORY_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setNewCatColor(c)}
                    className={`h-6 w-6 rounded-full transition-transform ${newCatColor === c ? 'scale-125 ring-2 ring-slate-400 ring-offset-1' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <button onClick={addCategory} className="w-full rounded-xl bg-indigo-500 py-2 text-sm font-semibold text-white">
                Add category
              </button>
            </div>
          )}
        </>
      )}

      {/* Date + Account */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <Label>Date</Label>
          <input
            type="date"
            value={date}
            max={todayISO()}
            onChange={e => { setDate(e.target.value); setDuplicate(null) }}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
        </div>
        {type !== 'transfer' && (
          <div>
            <Label>Account</Label>
            <select
              value={effectiveAccountId ?? ''}
              onChange={e => setAccountId(e.target.value)}
              className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Note */}
      <Label>Note</Label>
      <input
        placeholder="Optional note…"
        value={note}
        onChange={e => setNote(e.target.value)}
        className="mb-4 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />

      {/* Receipt (expense only) */}
      {type === 'expense' && (
        <>
          <Label>Receipt</Label>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => setReceipt(e.target.files?.[0] ?? null)} />
          <button
            onClick={() => fileRef.current?.click()}
            className="mb-4 flex w-full items-center gap-2 rounded-2xl border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-600"
          >
            📎 {receipt ? receipt.name : existingReceipt ? 'Replace existing receipt' : 'Attach a receipt photo'}
            {receipt && (
              <span
                onClick={e => { e.stopPropagation(); setReceipt(null); if (fileRef.current) fileRef.current.value = '' }}
                className="ml-auto text-rose-500"
              >
                ✕
              </span>
            )}
          </button>
        </>
      )}

      {/* Salary => new period */}
      {isSalary && (
        <label className="mb-4 flex items-center justify-between rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            🗓️ Start a new budget month from this date
          </span>
          <input type="checkbox" checked={startsPeriod} onChange={e => setStartsPeriod(e.target.checked)} className="h-5 w-5 accent-emerald-500" />
        </label>
      )}

      {edit?.startsPeriod && (
        <p className="mb-4 rounded-2xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          ⚠️ This salary started a budget month. Editing it won't move the month's start date.
        </p>
      )}

      {duplicate && (
        <div className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">⚠️ Possible duplicate</p>
          <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
            A {duplicate.type} of {fmt(duplicate.amountMinor, duplicate.currency, { compactCents: true })} already exists on{' '}
            {friendlyDate(duplicate.date)}
            {duplicate.note && ` (“${duplicate.note}”)`}. Save anyway?
          </p>
        </div>
      )}

      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}

      <button
        onClick={save}
        disabled={saving}
        className={`w-full rounded-2xl py-3.5 text-base font-bold text-white shadow-lg transition-transform active:scale-[0.98] disabled:opacity-50 ${
          duplicate ? 'bg-gradient-to-r from-amber-500 to-orange-500 shadow-amber-500/30' : meta.button
        }`}
      >
        {saving ? 'Saving…' : duplicate ? 'Add anyway' : edit ? 'Save changes' : meta.saveLabel}
      </button>
    </Sheet>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</p>
}

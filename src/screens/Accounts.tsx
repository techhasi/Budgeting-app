import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, DEFAULT_SETTINGS, MARKET_TYPES, type Account, type Currency, type Investment, type Recurring, type Txn } from '../db/db'
import { fmt, toLKR, parseAmount, convertMinor, CURRENCY_SYMBOL } from '../lib/money'
import { shortDate, currentMonth, endOfMonthISO, periodLabel } from '../lib/dates'
import { txnsInPeriod } from '../lib/periods'
import { computeBalances, addAdjustment } from '../lib/balances'
import { loanRemainingByAccount, loanInstallmentByAccount } from '../lib/recurring'
import { currentValueMinor, profitMinor, fdMaturityMinor } from '../lib/investments'
import { fetchPriceUSD } from '../lib/prices'
import { marketApiKey } from '../lib/env'
import Sheet from '../components/Sheet'
import RecurringSheet from '../components/RecurringSheet'
import InvestmentSheet, { INVESTMENT_TYPES } from '../components/InvestmentSheet'

const ACCOUNT_TYPES = [
  { id: 'cash', label: 'Cash', emoji: '💵' },
  { id: 'bank', label: 'Bank', emoji: '🏦' },
  { id: 'debit', label: 'Debit card', emoji: '🏧' },
  { id: 'credit', label: 'Credit card', emoji: '💳' }
] as const

const ACCOUNT_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#ef4444', '#64748b']

export default function Accounts() {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.toArray(), [], [])
  const recurring = useLiveQuery(() => db.recurring.orderBy('nextDue').toArray(), [], [])
  const investments = useLiveQuery(() => db.investments.toArray(), [], [])

  const [accountSheet, setAccountSheet] = useState<{ edit?: Account; balanceMinor?: number } | null>(null)
  const [detailSheet, setDetailSheet] = useState<{ account: Account; balanceMinor: number } | null>(null)
  const [recurringSheet, setRecurringSheet] = useState<{ edit?: Recurring } | null>(null)
  const [investmentSheet, setInvestmentSheet] = useState<{ edit?: Investment } | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const usdRate = settings?.usdRate ?? 300

  const balances = useMemo(() => computeBalances(accounts, txns, usdRate), [accounts, txns, usdRate])
  const loanRem = useMemo(() => loanRemainingByAccount(recurring), [recurring])
  const loanInst = useMemo(() => loanInstallmentByAccount(recurring), [recurring])

  const accountsTotal = accounts.reduce(
    (s, a) => s + toLKR(balances.get(a.id) ?? 0, a.currency ?? 'LKR', usdRate),
    0
  )
  const investedTotal = investments.reduce((s, i) => s + toLKR(currentValueMinor(i, usdRate), i.currency, usdRate), 0)
  const hasMarket = investments.some(i => MARKET_TYPES.includes(i.type))

  async function refreshPrices() {
    setRefreshing(true)
    const key = marketApiKey(settings) ?? ''
    for (const inv of investments) {
      if (!MARKET_TYPES.includes(inv.type)) continue
      try {
        const price = await fetchPriceUSD(inv, key)
        await db.investments.update(inv.id, { livePriceMinor: Math.round(price * 100), livePriceAt: Date.now() })
      } catch {
        // skip assets we can't price right now (missing key, bad symbol, offline)
      }
    }
    setRefreshing(false)
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Accounts</h1>

      {/* Net worth */}
      <div className="mb-5 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-900 p-5 text-white shadow-xl dark:from-indigo-600 dark:to-purple-700">
        <p className="text-xs uppercase tracking-widest text-slate-300 dark:text-indigo-200">Net worth</p>
        <p className="text-3xl font-bold tabular-nums">{fmt(accountsTotal + investedTotal, 'LKR', { compactCents: true })}</p>
        {investedTotal > 0 && (
          <p className="mt-1 text-xs text-slate-300 dark:text-indigo-200">
            {fmt(accountsTotal, 'LKR', { compactCents: true })} in accounts · {fmt(investedTotal, 'LKR', { compactCents: true })} invested
          </p>
        )}
      </div>

      {/* Accounts */}
      <SectionHeader title="Accounts" onAdd={() => setAccountSheet({})} />
      <div className="mb-6 space-y-3">
        {accounts.map(a => {
          const bal = balances.get(a.id) ?? 0
          const accCur = a.currency ?? 'LKR'
          const t = ACCOUNT_TYPES.find(t => t.id === a.type)
          const usedMinor = a.type === 'credit' ? Math.max(0, -bal) : 0
          const limitUsage = a.type === 'credit' && a.creditLimitMinor ? usedMinor / a.creditLimitMinor : null
          return (
            <button
              key={a.id}
              onClick={() => setDetailSheet({ account: a, balanceMinor: bal })}
              className="block w-full rounded-2xl bg-white p-4 text-left shadow-sm active:bg-slate-50 dark:bg-slate-800/60 dark:active:bg-slate-700/40"
            >
            <div className="flex w-full items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-xl" style={{ backgroundColor: `${a.color}22` }}>
                {a.isSavings ? '🐷' : t?.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{a.name}</p>
                <p className="text-xs text-slate-400">
                  {a.isSavings ? 'Savings' : (t?.label ?? a.type)}
                  {accCur !== 'LKR' && ` · ${accCur}`}
                  {a.numberHint && ` · •••${a.numberHint}`}
                </p>
                {a.type === 'credit' && a.lastPaidMonth !== currentMonth() &&
                  Math.max(0, -bal - (loanRem.get(a.id) ?? 0)) + (loanInst.get(a.id) ?? 0) > 0 && (
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                      {fmt(Math.max(0, -bal - (loanRem.get(a.id) ?? 0)) + (loanInst.get(a.id) ?? 0), accCur, { compactCents: true })} due by{' '}
                      {shortDate(endOfMonthISO())}
                    </p>
                  )}
              </div>
              <div className="text-right">
                <p className={`text-base font-bold tabular-nums ${bal < 0 ? 'text-rose-500' : ''}`}>
                  {fmt(bal, accCur, { compactCents: true })}
                </p>
                {a.type === 'credit' && a.creditLimitMinor != null && (
                  <p className="text-xs font-semibold tabular-nums text-emerald-500">
                    {fmt(Math.max(0, a.creditLimitMinor + bal), accCur, { compactCents: true })} available
                  </p>
                )}
              </div>
            </div>
            {limitUsage !== null && (
              <div className="mt-2.5 pl-[56px]">
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.round(limitUsage * 100))}%`,
                      backgroundColor: limitUsage > 0.9 ? '#ef4444' : limitUsage > 0.7 ? '#f59e0b' : '#0ea5e9'
                    }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  {fmt(usedMinor, accCur, { compactCents: true })} of {fmt(a.creditLimitMinor!, accCur, { compactCents: true })} limit used
                  {' '}({Math.round(limitUsage * 100)}%)
                </p>
              </div>
            )}
            </button>
          )
        })}
      </div>

      {/* Recurring payments */}
      <SectionHeader title="Recurring & loans" onAdd={() => setRecurringSheet({})} />
      {recurring.length === 0 ? (
        <EmptyHint text="Add rent, subscriptions, or loan installments — they'll pop up on Home when due." />
      ) : (
        <div className="mb-6 space-y-3">
          {recurring.map(r => {
            const progress = r.kind === 'loan' && r.principalMinor ? Math.min(1, (r.paidMinor ?? 0) / r.principalMinor) : null
            return (
              <button
                key={r.id}
                onClick={() => setRecurringSheet({ edit: r })}
                className="block w-full rounded-2xl bg-white p-4 text-left shadow-sm active:bg-slate-50 dark:bg-slate-800/60 dark:active:bg-slate-700/40"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/10 text-lg">
                    {r.kind === 'loan' ? '🏦' : '🔁'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.name}</p>
                    <p className="text-xs text-slate-400">
                      due {shortDate(r.nextDue)} · every {r.intervalMonths === 1 ? 'month' : `${r.intervalMonths} months`}
                    </p>
                  </div>
                  <p className="text-sm font-bold tabular-nums">{fmt(r.amountMinor, r.currency, { compactCents: true })}</p>
                </div>
                {progress !== null && (
                  <div className="mt-2.5 pl-[52px]">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {fmt(r.paidMinor ?? 0, r.currency, { compactCents: true })} of {fmt(r.principalMinor!, r.currency, { compactCents: true })} paid
                      {progress >= 1 && ' 🎉'}
                    </p>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Investments */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Investments & savings</h2>
        <div className="flex items-center gap-2">
          {hasMarket && (
            <button
              onClick={refreshPrices}
              disabled={refreshing}
              className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"
            >
              {refreshing ? '…' : '↻ Prices'}
            </button>
          )}
          <button onClick={() => setInvestmentSheet({})} className="rounded-xl bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/30">
            + Add
          </button>
        </div>
      </div>
      {investments.length === 0 ? (
        <EmptyHint text="Track FDs, stocks, crypto, gold, EPF and savings here — they count toward net worth." />
      ) : (
        <div className="mb-6 space-y-3">
          {investments.map(i => {
            const t = INVESTMENT_TYPES.find(t => t.id === i.type)
            const curVal = currentValueMinor(i, usdRate)
            const pl = profitMinor(i, usdRate)
            const mat = i.type === 'fd' ? fdMaturityMinor(i) : null
            const sub =
              i.type === 'fd' && i.maturityDate
                ? `Matures ${shortDate(i.maturityDate)}${mat != null ? ` · ~${fmt(mat, i.currency, { compactCents: true })}` : ''}`
                : MARKET_TYPES.includes(i.type) && i.quantity != null
                  ? `${i.quantity} ${i.unit ?? ''}${i.symbol ? ` · ${i.symbol}` : ''}`.trim()
                  : t?.label
            return (
              <button
                key={i.id}
                onClick={() => setInvestmentSheet({ edit: i })}
                className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm active:bg-slate-50 dark:bg-slate-800/60 dark:active:bg-slate-700/40"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-xl">{t?.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{i.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {sub}
                    {i.note && ` · ${i.note}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-base font-bold tabular-nums">{fmt(curVal, i.currency, { compactCents: true })}</p>
                  {pl != null && (
                    <p className={`text-xs font-semibold tabular-nums ${pl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {pl >= 0 ? '▲' : '▼'} {fmt(Math.abs(pl), i.currency, { compactCents: true })}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {detailSheet && (
        <AccountDetailSheet
          account={detailSheet.account}
          balanceMinor={detailSheet.balanceMinor}
          accounts={accounts}
          onClose={() => setDetailSheet(null)}
          onEdit={() => {
            setAccountSheet({ edit: detailSheet.account, balanceMinor: detailSheet.balanceMinor })
            setDetailSheet(null)
          }}
        />
      )}
      {accountSheet && (
        <AccountSheet edit={accountSheet.edit} balanceMinor={accountSheet.balanceMinor} onClose={() => setAccountSheet(null)} />
      )}
      {recurringSheet && <RecurringSheet edit={recurringSheet.edit} onClose={() => setRecurringSheet(null)} />}
      {investmentSheet && <InvestmentSheet edit={investmentSheet.edit} onClose={() => setInvestmentSheet(null)} />}
    </div>
  )
}

function SectionHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
      <button onClick={onAdd} className="rounded-xl bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-indigo-500/30">
        + Add
      </button>
    </div>
  )
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="mb-6 rounded-2xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-400 dark:border-slate-700">
      {text}
    </p>
  )
}

/** Salary-cycle view of a single account's activity: spent, earned, and every transaction. */
function AccountDetailSheet({
  account,
  balanceMinor,
  accounts,
  onClose,
  onEdit
}: {
  account: Account
  balanceMinor: number
  accounts: Account[]
  onClose: () => void
  onEdit: () => void
}) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const periods = useLiveQuery(() => db.periods.orderBy('startDate').toArray(), [], [])
  const txns = useLiveQuery(() => db.txns.where('accountId').equals(account.id).toArray(), [account.id], [])
  const incoming = useLiveQuery(() => db.txns.filter(t => t.toAccountId === account.id).toArray(), [account.id], [])
  const categories = useLiveQuery(() => db.categories.toArray(), [], [])

  const usdRate = settings?.usdRate ?? 300
  const accCur = account.currency ?? 'LKR'
  const [periodOffset, setPeriodOffset] = useState(0) // 0 = current cycle
  const period = periods.length ? periods[Math.max(0, periods.length - 1 - periodOffset)] : undefined

  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])
  const accById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts])

  const rows = useMemo(() => {
    if (!period) return []
    // toAccountId query can't be an index (schema has none), so incoming is scanned in memory
    const all = [...txns, ...incoming.filter(t => t.type === 'transfer')]
    return txnsInPeriod(all, period).sort((a, b) =>
      a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1
    )
  }, [txns, incoming, period])

  let spent = 0
  let earned = 0
  for (const t of rows) {
    if (t.adjustment || t.type === 'transfer') continue
    const inAcc = convertMinor(t.amountMinor, t.currency, accCur, usdRate)
    if (t.type === 'expense') spent += inAcc
    else earned += inAcc
  }

  function rowView(t: Txn) {
    if (t.type === 'transfer') {
      const out = t.accountId === account.id
      const other = accById.get(out ? (t.toAccountId ?? '') : t.accountId)?.name ?? 'account'
      const amt = out ? convertMinor(t.amountMinor, t.currency, accCur, usdRate) : t.toAmountMinor ?? convertMinor(t.amountMinor, t.currency, accCur, usdRate)
      return { emoji: '🔄', title: out ? `Transfer to ${other}` : `Transfer from ${other}`, sub: t.note || undefined, sign: out ? -1 : 1, amt, muted: true }
    }
    const income = t.type === 'income'
    const amt = convertMinor(t.amountMinor, t.currency, accCur, usdRate)
    if (t.adjustment) return { emoji: '⚖️', title: t.note || 'Balance adjustment', sub: undefined, sign: income ? 1 : -1, amt, muted: true }
    const cat = catById.get(t.categoryId)
    return { emoji: cat?.emoji ?? (income ? '💰' : '💸'), title: t.note || cat?.name || (income ? 'Income' : 'Expense'), sub: t.note ? cat?.name : undefined, sign: income ? 1 : -1, amt, muted: false }
  }

  return (
    <Sheet
      onClose={onClose}
      title={
        <div className="flex items-center justify-between">
          <span className="truncate">{account.name}</span>
          <button onClick={onEdit} className="ml-2 shrink-0 rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Edit
          </button>
        </div>
      }
    >
      <p className="-mt-1 mb-3 text-xs text-slate-400">
        Balance {fmt(balanceMinor, accCur, { compactCents: true })}
      </p>

      {/* Cycle navigator */}
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setPeriodOffset(o => Math.min(o + 1, periods.length - 1))}
          disabled={periodOffset >= periods.length - 1}
          className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm disabled:opacity-30 dark:bg-slate-800"
        >
          ‹
        </button>
        <p className="text-sm font-bold">{period ? periodLabel(period.startDate, period.endDate) : '—'}</p>
        <button
          onClick={() => setPeriodOffset(o => Math.max(o - 1, 0))}
          disabled={periodOffset === 0}
          className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm disabled:opacity-30 dark:bg-slate-800"
        >
          ›
        </button>
      </div>

      {/* Spent / earned summary */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-rose-50 p-3 dark:bg-rose-500/10">
          <p className="text-xs font-medium text-rose-600 dark:text-rose-400">Spent</p>
          <p className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">{fmt(spent, accCur, { compactCents: true })}</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3 dark:bg-emerald-500/10">
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Earned</p>
          <p className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(earned, accCur, { compactCents: true })}</p>
        </div>
      </div>

      {/* Transactions */}
      <div className="space-y-2">
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
            No activity this cycle.
          </p>
        ) : (
          rows.map(t => {
            const v = rowView(t)
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm dark:bg-slate-800/60">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-base dark:bg-slate-700/60">{v.emoji}</span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-medium ${v.muted ? 'text-slate-500 dark:text-slate-400' : ''}`}>{v.title}</p>
                  <p className="truncate text-xs text-slate-400">{shortDate(t.date)}{v.sub ? ` · ${v.sub}` : ''}</p>
                </div>
                <p className={`shrink-0 text-sm font-bold tabular-nums ${v.muted ? 'text-slate-400' : v.sign > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {v.sign > 0 ? '+' : '−'}{fmt(v.amt, accCur, { compactCents: true })}
                </p>
              </div>
            )
          })
        )}
      </div>
    </Sheet>
  )
}

function AccountSheet({ edit, balanceMinor, onClose }: { edit?: Account; balanceMinor?: number; onClose: () => void }) {
  const [name, setName] = useState(edit?.name ?? '')
  const [type, setType] = useState<Account['type']>(edit?.type ?? 'bank')
  const [accCurrency, setAccCurrency] = useState<Currency>(edit?.currency ?? 'LKR')
  const [color, setColor] = useState(edit?.color ?? ACCOUNT_COLORS[1])
  const [opening, setOpening] = useState(edit && edit.openingMinor ? (edit.openingMinor / 100).toFixed(2) : '')
  const [numberHint, setNumberHint] = useState(edit?.numberHint ?? '')
  const [isSavings, setIsSavings] = useState(edit?.isSavings ?? false)
  const [creditLimit, setCreditLimit] = useState(edit?.creditLimitMinor ? (edit.creditLimitMinor / 100).toFixed(2) : '')
  const [available, setAvailable] = useState('')
  const [actualBalance, setActualBalance] = useState('')
  const [error, setError] = useState('')

  async function save() {
    if (!name.trim()) return setError('Enter a name')
    const hint = numberHint.replace(/\D/g, '').slice(-4)
    const fields: Partial<Account> = {
      name: name.trim(),
      type,
      color,
      isSavings: type === 'bank' ? isSavings || undefined : undefined,
      currency: accCurrency,
      numberHint: hint || undefined,
      statementMinor: undefined
    }

    if (type === 'credit') {
      const limitMinor = creditLimit.trim() ? parseAmount(creditLimit) : undefined
      if (creditLimit.trim() && !limitMinor) return setError('Invalid credit limit')
      fields.creditLimitMinor = limitMinor ?? undefined

      // User enters what's AVAILABLE to spend; owed balance = available − limit
      let targetBalance: number | null = null
      if (available.trim()) {
        if (!limitMinor) return setError('Enter the credit limit first')
        const avail = parseAmount(available, { allowZero: true })
        if (avail === null) return setError('Invalid available amount')
        targetBalance = avail - limitMinor
      }
      if (edit) {
        await db.accounts.update(edit.id, fields)
        if (targetBalance !== null) {
          const diff = targetBalance - (balanceMinor ?? 0)
          if (diff !== 0) await addAdjustment(edit.id, diff, 'Balance set from available credit', undefined, accCurrency)
        }
      } else {
        await db.accounts.add({ id: uid(), openingMinor: targetBalance ?? 0, ...fields } as Account)
      }
    } else {
      fields.creditLimitMinor = undefined
      const openingMinor = opening.trim() ? parseAmount(opening, { allowZero: true, allowNegative: true }) : 0
      if (openingMinor === null) return setError('Invalid opening balance')
      if (edit) {
        await db.accounts.update(edit.id, { ...fields, openingMinor })
        if (actualBalance.trim()) {
          const target = parseAmount(actualBalance, { allowZero: true, allowNegative: true })
          if (target === null) return setError('Invalid actual balance')
          const diff = target - (balanceMinor ?? 0)
          if (diff !== 0) await addAdjustment(edit.id, diff, 'Manual balance adjustment', undefined, accCurrency)
        }
      } else {
        await db.accounts.add({ id: uid(), ...fields, openingMinor } as Account)
      }
    }
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={edit ? 'Edit account' : 'New account'}>
      <input
        autoFocus={!edit}
        placeholder="Account name (e.g. HNB Savings)"
        value={name}
        onChange={e => setName(e.target.value)}
        className="mb-3 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />
      <div className="mb-3 grid grid-cols-2 gap-2">
        {ACCOUNT_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => setType(t.id)}
            className={`rounded-2xl border-2 p-3 text-sm font-medium ${
              type === t.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-transparent bg-slate-50 dark:bg-slate-800/60'
            }`}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>
      {type === 'bank' && (
        <label className="mb-3 flex items-center justify-between rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <span className="text-sm font-medium">🐷 Savings account</span>
          <input
            type="checkbox"
            checked={isSavings}
            onChange={e => setIsSavings(e.target.checked)}
            className="h-5 w-5 accent-indigo-500"
          />
        </label>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {ACCOUNT_COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`h-7 w-7 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-slate-400 ring-offset-1' : ''}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="mb-3 flex items-center justify-between rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
        <span className="text-sm font-medium">Account currency</span>
        <div className="flex rounded-xl bg-slate-200/70 p-0.5 dark:bg-slate-700/60">
          {(['LKR', 'USD'] as const).map(c => (
            <button
              key={c}
              onClick={() => setAccCurrency(c)}
              className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold ${
                accCurrency === c ? 'bg-white text-indigo-600 shadow dark:bg-slate-900 dark:text-indigo-400' : 'text-slate-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      {edit && accCurrency !== (edit.currency ?? 'LKR') && (
        <p className="mb-3 rounded-2xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          ⚠️ Changing currency reinterprets this account's opening balance in {accCurrency} — check the balance after saving.
        </p>
      )}
      {type !== 'credit' && (
        <input
          placeholder={`Opening balance (${CURRENCY_SYMBOL[accCurrency]}, optional)`}
          inputMode="text"
          value={opening}
          onChange={e => setOpening(e.target.value)}
          className="mb-3 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
        />
      )}
      <input
        placeholder="Card/account last 4 digits (for SMS matching)"
        inputMode="numeric"
        value={numberHint}
        onChange={e => setNumberHint(e.target.value)}
        className="mb-1 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
      />
      <p className="mb-4 text-xs text-slate-400">
        SMS imports mentioning these digits will pick this account automatically.
      </p>
      {type === 'credit' && (
        <>
          <input
            placeholder="Credit limit (Rs)"
            inputMode="decimal"
            value={creditLimit}
            onChange={e => setCreditLimit(e.target.value)}
            className="mb-1 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
          <p className="mb-3 text-xs text-slate-400">Your total credit limit.</p>
          <input
            placeholder={
              edit
                ? `Available to spend now (app shows ${fmt(Math.max(0, (edit.creditLimitMinor ?? 0) + (balanceMinor ?? 0)), accCurrency, { compactCents: true })})`
                : 'Available to spend now (Rs)'
            }
            inputMode="decimal"
            value={available}
            onChange={e => setAvailable(e.target.value)}
            className="mb-1 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
          <p className="mb-4 text-xs text-slate-400">
            💡 Enter what you can still spend — HasiKasi works out what you owe (limit − available) automatically.
          </p>
        </>
      )}
      {edit && type !== 'credit' && (
        <>
          <input
            placeholder={`Actual balance now (app shows ${fmt(balanceMinor ?? 0, accCurrency, { compactCents: true })})`}
            inputMode="decimal"
            value={actualBalance}
            onChange={e => setActualBalance(e.target.value)}
            className="mb-1 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
          <p className="mb-4 text-xs text-slate-400">
            ⚖️ Enter what the bank actually shows and the difference is logged as an adjustment (doesn't affect
            spending stats).
          </p>
        </>
      )}
      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}
      <button onClick={save} className="w-full rounded-2xl bg-indigo-500 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30">
        {edit ? 'Save changes' : 'Add account'}
      </button>
    </Sheet>
  )
}

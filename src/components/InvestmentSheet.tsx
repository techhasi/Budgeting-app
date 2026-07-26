import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, DEFAULT_SETTINGS, MARKET_TYPES, type Currency, type Investment, type InvestmentType } from '../db/db'
import { parseAmount, fmt, convertMinor, CURRENCY_SYMBOL } from '../lib/money'
import { addAdjustment } from '../lib/balances'
import { fetchPriceUSD, goldQtyToOz } from '../lib/prices'
import { gcalClientId, marketApiKey } from '../lib/env'
import { fdMaturityMinor } from '../lib/investments'
import { addReminder, deleteReminder } from '../lib/reminders'
import { todayISO } from '../lib/dates'
import Sheet from './Sheet'

export const INVESTMENT_TYPES: { id: InvestmentType; label: string; emoji: string }[] = [
  { id: 'savings', label: 'Savings', emoji: '💰' },
  { id: 'fd', label: 'Fixed deposit', emoji: '🏦' },
  { id: 'stocks', label: 'Stocks', emoji: '📈' },
  { id: 'crypto', label: 'Crypto', emoji: '🪙' },
  { id: 'gold', label: 'Gold', emoji: '🥇' },
  { id: 'epf', label: 'EPF/ETF', emoji: '🏛️' },
  { id: 'other', label: 'Other', emoji: '📦' }
]

const GOLD_UNITS = [
  { id: 'g', label: 'grams' },
  { id: 'sovereign', label: 'sovereigns' },
  { id: 'oz', label: 'troy oz' }
]

const inputCls =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60'

function defaultUnit(t: InvestmentType): string {
  return t === 'gold' ? 'g' : t === 'stocks' ? 'shares' : t === 'crypto' ? 'coins' : ''
}

/** Add or edit an investment / savings entry. */
export default function InvestmentSheet({ edit, onClose }: { edit?: Investment; onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const usdRate = settings?.usdRate ?? 300

  const [name, setName] = useState(edit?.name ?? '')
  const [type, setType] = useState<InvestmentType>(edit?.type ?? 'savings')
  const [value, setValue] = useState(edit ? (edit.valueMinor / 100).toFixed(2) : '')
  const [currency, setCurrency] = useState<Currency>(edit?.currency ?? 'LKR')
  const [note, setNote] = useState(edit?.note ?? '')

  // Fixed deposit
  const [sourceAccountId, setSourceAccountId] = useState(edit?.sourceAccountId ?? '')
  const [startDate, setStartDate] = useState(edit?.startDate ?? todayISO())
  const [maturityDate, setMaturityDate] = useState(edit?.maturityDate ?? '')
  const [interestRate, setInterestRate] = useState(edit?.interestRate != null ? String(edit.interestRate) : '')
  const [maturityAmount, setMaturityAmount] = useState(
    edit?.maturityAmountMinor != null ? (edit.maturityAmountMinor / 100).toFixed(2) : ''
  )
  const [remindMaturity, setRemindMaturity] = useState(!!edit?.reminderId)

  // Market assets
  const [symbol, setSymbol] = useState(edit?.symbol ?? '')
  const [quantity, setQuantity] = useState(edit?.quantity != null ? String(edit.quantity) : '')
  const [unit, setUnit] = useState(edit?.unit ?? defaultUnit(edit?.type ?? 'savings'))
  const [costBasis, setCostBasis] = useState(edit?.costBasisMinor != null ? (edit.costBasisMinor / 100).toFixed(2) : '')
  const [priceUSD, setPriceUSD] = useState<number | null>(
    edit?.livePriceMinor != null ? edit.livePriceMinor / 100 : null
  )
  const [fetching, setFetching] = useState(false)
  const [fetchErr, setFetchErr] = useState('')

  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  const isMarket = MARKET_TYPES.includes(type)
  const isFd = type === 'fd'
  const fundingAccounts = accounts.filter(a => a.type !== 'credit')

  function pickType(t: InvestmentType) {
    setType(t)
    if (MARKET_TYPES.includes(t) && !unit) setUnit(defaultUnit(t))
    if (t === 'gold' && unit !== 'g' && unit !== 'sovereign' && unit !== 'oz') setUnit('g')
    if (t === 'stocks') setUnit('shares')
    if (t === 'crypto') setUnit('coins')
  }

  // Live market value + profit/loss preview (in the chosen currency)
  const preview = useMemo(() => {
    if (!isMarket || priceUSD == null) return null
    const qty = Number(quantity)
    if (!isFinite(qty) || qty <= 0) return null
    const units = type === 'gold' ? goldQtyToOz(qty, unit) : qty
    const usdMinor = Math.round(units * priceUSD * 100)
    const valMinor = convertMinor(usdMinor, 'USD', currency, usdRate)
    const cb = parseAmount(costBasis, { allowZero: true })
    const pl = cb != null && cb > 0 ? valMinor - cb : null
    const plPct = pl != null && cb ? (pl / cb) * 100 : null
    return { valMinor, pl, plPct }
  }, [isMarket, priceUSD, quantity, unit, type, currency, usdRate, costBasis])

  const maturityPreview = useMemo(() => {
    if (!isFd) return null
    const principal = parseAmount(value, { allowZero: true }) ?? 0
    return fdMaturityMinor({
      valueMinor: principal,
      maturityAmountMinor: maturityAmount.trim() ? (parseAmount(maturityAmount) ?? undefined) : undefined,
      interestRate: interestRate.trim() ? Number(interestRate) : undefined,
      maturityDate: maturityDate || undefined,
      startDate: startDate || undefined
    } as Investment)
  }, [isFd, value, maturityAmount, interestRate, maturityDate, startDate])

  async function fetchPrice() {
    setFetching(true)
    setFetchErr('')
    try {
      const price = await fetchPriceUSD({ type, symbol: type === 'gold' ? symbol || 'XAU/USD' : symbol }, marketApiKey(settings) ?? '')
      setPriceUSD(price)
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : 'Price lookup failed')
    } finally {
      setFetching(false)
    }
  }

  async function save() {
    if (!name.trim()) return setError('Enter a name')
    const id = edit?.id ?? uid()

    const fields: Partial<Investment> = {
      name: name.trim(),
      type,
      currency,
      note: note.trim(),
      updatedAt: Date.now()
    }

    if (isFd) {
      const principal = parseAmount(value)
      if (!principal) return setError('Enter the deposit amount')
      fields.valueMinor = principal
      fields.startDate = startDate || todayISO()
      fields.maturityDate = maturityDate || undefined
      fields.interestRate = interestRate.trim() ? Number(interestRate) : undefined
      fields.maturityAmountMinor = maturityAmount.trim() ? (parseAmount(maturityAmount) ?? undefined) : undefined
      fields.sourceAccountId = sourceAccountId || undefined
      // clear market fields
      fields.symbol = undefined
      fields.quantity = undefined
      fields.costBasisMinor = undefined
      fields.livePriceMinor = undefined

      // Reminder sync (delete old, recreate if enabled)
      if (edit?.reminderId) {
        const old = await db.reminders.get(edit.reminderId)
        if (old) await deleteReminder(old)
        fields.reminderId = undefined
      }
      if (remindMaturity && fields.maturityDate) {
        const matStr = maturityPreview != null ? ` — ${fmt(maturityPreview, currency, { compactCents: true })} at maturity` : ''
        const { reminder } = await addReminder(
          { title: `FD matures: ${name.trim()}`, date: fields.maturityDate, note: `Fixed deposit${matStr}`, source: 'fd', refId: id },
          { pushToCalendar: true, clientId: gcalClientId(settings) }
        )
        fields.reminderId = reminder.id
      } else {
        fields.reminderId = undefined
      }
    } else if (isMarket) {
      const qty = Number(quantity)
      if (!isFinite(qty) || qty <= 0) return setError('Enter the quantity held')
      if (type !== 'gold' && !symbol.trim()) return setError(type === 'crypto' ? 'Enter the coin id (e.g. bitcoin)' : 'Enter the ticker (e.g. AAPL)')
      const cb = parseAmount(costBasis, { allowZero: true })
      fields.symbol = type === 'gold' ? symbol.trim() || 'XAU/USD' : symbol.trim()
      fields.quantity = qty
      fields.unit = unit || defaultUnit(type)
      fields.costBasisMinor = cb ?? undefined
      if (priceUSD != null) {
        fields.livePriceMinor = Math.round(priceUSD * 100)
        fields.livePriceAt = Date.now()
        fields.valueMinor = preview?.valMinor ?? cb ?? edit?.valueMinor ?? 0
      } else {
        fields.valueMinor = cb ?? edit?.valueMinor ?? 0
      }
      // clear FD fields
      fields.maturityDate = undefined
      fields.interestRate = undefined
      fields.maturityAmountMinor = undefined
      fields.reminderId = undefined
    } else {
      const valueMinor = parseAmount(value)
      if (!valueMinor) return setError('Enter a valid value')
      fields.valueMinor = valueMinor
    }

    if (edit) await db.investments.update(id, fields)
    else await db.investments.add({ id, valueMinor: 0, ...fields } as Investment)

    // New FD funded from an account → move the principal out of it (keeps net worth honest)
    if (!edit && isFd && sourceAccountId) {
      const acc = accounts.find(a => a.id === sourceAccountId)
      if (acc) {
        const accCur = acc.currency ?? 'LKR'
        const out = convertMinor(fields.valueMinor ?? 0, currency, accCur, usdRate)
        if (out > 0) await addAdjustment(sourceAccountId, -out, `Fixed deposit: ${name.trim()}`, fields.startDate, accCur)
      }
    }

    onClose()
  }

  async function remove() {
    if (!edit) return
    if (edit.reminderId) {
      const r = await db.reminders.get(edit.reminderId)
      if (r) await deleteReminder(r)
    }
    await db.investments.delete(edit.id)
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={edit ? 'Update investment' : 'New investment / savings'}>
      <input
        autoFocus={!edit}
        placeholder="Name (e.g. NSB FD, CSE portfolio, Gold coins)"
        value={name}
        onChange={e => setName(e.target.value)}
        className={`mb-3 ${inputCls}`}
      />

      <div className="mb-3 grid grid-cols-3 gap-2">
        {INVESTMENT_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => pickType(t.id)}
            className={`rounded-2xl border-2 p-2.5 text-xs font-medium ${
              type === t.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-transparent bg-slate-50 dark:bg-slate-800/60'
            }`}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {/* Currency toggle (shared) */}
      <div className="mb-3 flex items-center justify-between rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
        <span className="text-sm font-medium">Currency</span>
        <div className="flex rounded-xl bg-slate-200/70 p-0.5 dark:bg-slate-700/60">
          {(['LKR', 'USD'] as const).map(c => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`rounded-[10px] px-3 py-1.5 text-xs font-semibold ${
                currency === c ? 'bg-white text-indigo-600 shadow dark:bg-slate-900 dark:text-indigo-400' : 'text-slate-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Plain value (savings / epf / other) */}
      {!isMarket && !isFd && (
        <>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Current value</p>
          <input inputMode="decimal" placeholder="0.00" value={value} onChange={e => setValue(e.target.value)} className={`mb-3 ${inputCls} tabular-nums`} />
        </>
      )}

      {/* Fixed deposit */}
      {isFd && (
        <>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Deposit amount (principal)</p>
          <input inputMode="decimal" placeholder="0.00" value={value} onChange={e => setValue(e.target.value)} className={`mb-3 ${inputCls} tabular-nums`} />

          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Fund from account (optional)</p>
          <select value={sourceAccountId} onChange={e => setSourceAccountId(e.target.value)} className={`mb-1 ${inputCls}`} disabled={!!edit}>
            <option value="">Don't move money from an account</option>
            {fundingAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <p className="mb-3 text-xs text-slate-400">
            {edit ? 'Funding is only applied when the FD is first created.' : 'Deducts the principal from this account so net worth stays correct.'}
          </p>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Start date</p>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Maturity date</p>
              <input type="date" value={maturityDate} onChange={e => setMaturityDate(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Interest rate (% / yr)</p>
              <input inputMode="decimal" placeholder="e.g. 12.5" value={interestRate} onChange={e => setInterestRate(e.target.value)} className={`${inputCls} tabular-nums`} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-slate-400">Maturity value (optional)</p>
              <input inputMode="decimal" placeholder="auto" value={maturityAmount} onChange={e => setMaturityAmount(e.target.value)} className={`${inputCls} tabular-nums`} />
            </div>
          </div>

          {maturityPreview != null && maturityPreview > 0 && (
            <p className="mb-3 rounded-2xl bg-emerald-50 p-3 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              📈 Grows to ~{fmt(maturityPreview, currency, { compactCents: true })} by maturity — net worth accrues gradually until then.
            </p>
          )}

          <label className="mb-3 flex items-center justify-between rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
            <span className="text-sm font-medium">🔔 Remind me on maturity date</span>
            <input type="checkbox" checked={remindMaturity} onChange={e => setRemindMaturity(e.target.checked)} className="h-5 w-5 accent-indigo-500" />
          </label>
          {remindMaturity && !maturityDate && <p className="mb-3 text-xs text-amber-500">Set a maturity date to enable the reminder.</p>}
          {remindMaturity && !gcalClientId(settings) && (
            <p className="mb-3 text-xs text-slate-400">Connect Google Calendar in Settings to also get a lock-screen alert; otherwise it stays in-app only.</p>
          )}
        </>
      )}

      {/* Market assets: crypto / gold / stocks */}
      {isMarket && (
        <>
          {type !== 'gold' && (
            <>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {type === 'crypto' ? 'Coin id (CoinGecko)' : 'Ticker symbol'}
              </p>
              <input
                placeholder={type === 'crypto' ? 'bitcoin, ethereum, solana…' : 'AAPL, VOO, MSFT…'}
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                className={`mb-3 ${inputCls}`}
                autoCapitalize={type === 'stocks' ? 'characters' : 'none'}
              />
            </>
          )}

          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Quantity held</p>
          <div className="mb-3 flex items-center gap-2">
            <input inputMode="decimal" placeholder="0" value={quantity} onChange={e => setQuantity(e.target.value)} className={`${inputCls} tabular-nums`} />
            {type === 'gold' ? (
              <select value={unit} onChange={e => setUnit(e.target.value)} className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
                {GOLD_UNITS.map(u => (
                  <option key={u.id} value={u.id}>{u.label}</option>
                ))}
              </select>
            ) : (
              <span className="shrink-0 rounded-2xl bg-slate-100 px-3 py-3 text-xs font-semibold text-slate-500 dark:bg-slate-800">{unit}</span>
            )}
          </div>

          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Amount paid (cost basis)</p>
          <div className="mb-3 flex items-center gap-1.5">
            <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-3 text-xs font-bold text-slate-500 dark:bg-slate-800">{CURRENCY_SYMBOL[currency]}</span>
            <input inputMode="decimal" placeholder="0.00" value={costBasis} onChange={e => setCostBasis(e.target.value)} className={`${inputCls} tabular-nums`} />
          </div>

          <button
            onClick={fetchPrice}
            disabled={fetching}
            className="mb-2 w-full rounded-2xl border-2 border-indigo-500 py-3 text-sm font-semibold text-indigo-600 disabled:opacity-50 dark:text-indigo-400"
          >
            {fetching ? 'Fetching…' : priceUSD != null ? `↻ Refresh price ($${priceUSD.toLocaleString()})` : '📡 Fetch live price'}
          </button>
          {fetchErr && <p className="mb-3 text-center text-xs font-medium text-rose-500">{fetchErr}</p>}
          {type !== 'crypto' && !marketApiKey(settings) && (
            <p className="mb-3 text-xs text-slate-400">Add a free Twelve Data API key in Settings to fetch {type === 'gold' ? 'gold' : 'stock'} prices.</p>
          )}
          {preview && (
            <div className="mb-3 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Current value</span>
                <span className="text-sm font-bold tabular-nums">{fmt(preview.valMinor, currency, { compactCents: true })}</span>
              </div>
              {preview.pl != null && (
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-xs text-slate-400">Profit / loss</span>
                  <span className={`text-sm font-bold tabular-nums ${preview.pl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {preview.pl >= 0 ? '▲' : '▼'} {fmt(Math.abs(preview.pl), currency, { compactCents: true })}
                    {preview.plPct != null && ` (${preview.plPct >= 0 ? '+' : ''}${preview.plPct.toFixed(1)}%)`}
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <input placeholder="Optional note…" value={note} onChange={e => setNote(e.target.value)} className={`mb-4 ${inputCls}`} />

      {error && <p className="mb-3 text-center text-sm font-medium text-rose-500">{error}</p>}

      <button onClick={save} className="mb-2 w-full rounded-2xl bg-indigo-500 py-3.5 font-bold text-white shadow-lg shadow-indigo-500/30">
        {edit ? 'Save' : 'Add'}
      </button>
      {edit &&
        (confirming ? (
          <div className="flex gap-3">
            <button onClick={() => setConfirming(false)} className="flex-1 rounded-2xl bg-slate-100 py-3 font-semibold dark:bg-slate-800">
              Cancel
            </button>
            <button onClick={remove} className="flex-1 rounded-2xl bg-rose-500 py-3 font-semibold text-white">
              Yes, delete
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="w-full rounded-2xl bg-rose-50 py-3 font-semibold text-rose-500 dark:bg-rose-500/10">
            Delete
          </button>
        ))}
    </Sheet>
  )
}

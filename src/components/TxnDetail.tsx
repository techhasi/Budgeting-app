import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Txn } from '../db/db'
import { fmt } from '../lib/money'
import { friendlyDate } from '../lib/dates'
import Sheet from './Sheet'
import AddSheet from './AddSheet'

export default function TxnDetail({ txn, onClose }: { txn: Txn; onClose: () => void }) {
  const category = useLiveQuery(() => db.categories.get(txn.categoryId), [txn.categoryId])
  const account = useLiveQuery(() => db.accounts.get(txn.accountId), [txn.accountId])
  const toAccount = useLiveQuery(
    () => (txn.toAccountId ? db.accounts.get(txn.toAccountId) : undefined),
    [txn.toAccountId]
  )
  const receipt = useLiveQuery(() => db.receipts.get(txn.id), [txn.id])
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)

  const isTransfer = txn.type === 'transfer'
  const isAdjustment = !!txn.adjustment

  useEffect(() => {
    if (!receipt) return
    const url = URL.createObjectURL(receipt.blob)
    setReceiptUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [receipt])

  async function remove() {
    await db.transaction('rw', [db.txns, db.receipts], async () => {
      await db.txns.delete(txn.id)
      await db.receipts.delete(txn.id)
    })
    onClose()
  }

  return (
    <Sheet onClose={onClose} title={null}>
      <div className="mb-4 flex flex-col items-center">
        <span
          className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl"
          style={{ backgroundColor: isTransfer || isAdjustment ? '#0ea5e922' : `${category?.color ?? '#64748b'}22` }}
        >
          {isAdjustment ? '⚖️' : isTransfer ? '⇄' : (category?.emoji ?? '❓')}
        </span>
        <p className="text-sm text-slate-500">{isAdjustment ? 'Balance adjustment' : isTransfer ? 'Transfer' : category?.name}</p>
        <p
          className={`text-3xl font-bold tabular-nums ${
            isTransfer ? 'text-sky-500' : txn.type === 'expense' ? 'text-rose-500' : 'text-emerald-500'
          }`}
        >
          {isTransfer ? '' : txn.type === 'expense' ? '−' : '+'}
          {fmt(txn.amountMinor, txn.currency, { compactCents: true })}
        </p>
      </div>

      <div className="mb-4 overflow-hidden rounded-2xl bg-slate-50 dark:bg-slate-800/60">
        <Row label="Date" value={friendlyDate(txn.date)} />
        {isTransfer ? (
          <>
            <Row label="From" value={account?.name ?? '—'} />
            <Row label="To" value={toAccount?.name ?? '—'} />
            {txn.toAmountMinor != null && toAccount && (toAccount.currency ?? 'LKR') !== txn.currency && (
              <Row label="Received" value={fmt(txn.toAmountMinor, toAccount.currency ?? 'LKR', { compactCents: true })} />
            )}
          </>
        ) : (
          <Row label="Account" value={account?.name ?? '—'} />
        )}
        <Row label="Currency" value={txn.currency} />
        {txn.note && <Row label="Note" value={txn.note} />}
        {txn.startsPeriod && <Row label="Budget month" value="Started a new period 🗓️" />}
      </div>

      {receiptUrl && (
        <img src={receiptUrl} alt="Receipt" className="mb-4 w-full rounded-2xl border border-slate-200 dark:border-slate-700" />
      )}

      {confirming ? (
        <div className="flex gap-3">
          <button onClick={() => setConfirming(false)} className="flex-1 rounded-2xl bg-slate-100 py-3 font-semibold dark:bg-slate-800">
            Cancel
          </button>
          <button onClick={remove} className="flex-1 rounded-2xl bg-rose-500 py-3 font-semibold text-white">
            Yes, delete
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          {/* Adjustments are corrections — delete and redo rather than edit */}
          {!isAdjustment && (
            <button
              onClick={() => setEditing(true)}
              className="flex-1 rounded-2xl bg-indigo-500 py-3 font-semibold text-white shadow-lg shadow-indigo-500/30"
            >
              ✏️ Edit
            </button>
          )}
          <button
            onClick={() => setConfirming(true)}
            className="flex-1 rounded-2xl bg-rose-50 py-3 font-semibold text-rose-500 dark:bg-rose-500/10"
          >
            Delete
          </button>
        </div>
      )}

      {editing && <AddSheet edit={txn} onSaved={onClose} onClose={() => setEditing(false)} />}
    </Sheet>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm last:border-0 dark:border-slate-700/50">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

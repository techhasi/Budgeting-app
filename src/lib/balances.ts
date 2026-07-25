import { db, uid, type Account, type Currency, type Txn } from '../db/db'
import { convertMinor } from './money'
import { todayISO } from './dates'

/** Log a balance correction: fixes the account balance without touching budget totals. */
export async function addAdjustment(
  accountId: string,
  diffMinor: number,
  note: string,
  date = todayISO(),
  currency: Currency = 'LKR'
): Promise<void> {
  await db.txns.add({
    id: uid(),
    type: diffMinor > 0 ? 'income' : 'expense',
    amountMinor: Math.abs(diffMinor),
    currency,
    categoryId: '',
    accountId,
    date,
    note,
    adjustment: true,
    createdAt: Date.now()
  })
}

/**
 * Per-account balances in minor units of each account's own currency
 * (opening + income − expenses ± transfers, cross-currency txns converted).
 */
export function computeBalances(accounts: Account[], txns: Txn[], usdRate: number): Map<string, number> {
  const accCurrency = new Map(accounts.map(a => [a.id, a.currency ?? 'LKR']))
  const map = new Map<string, number>()
  for (const a of accounts) map.set(a.id, a.openingMinor)
  const inAccount = (t: Txn, accountId: string) =>
    convertMinor(t.amountMinor, t.currency, accCurrency.get(accountId) ?? 'LKR', usdRate)
  for (const t of txns) {
    if (t.type === 'transfer') {
      // Amount leaving the source (in its currency) and arriving at the destination
      // (its own currency): use the explicit received amount when present, else convert.
      map.set(t.accountId, (map.get(t.accountId) ?? 0) - inAccount(t, t.accountId))
      if (t.toAccountId) {
        const arrived = t.toAmountMinor ?? inAccount(t, t.toAccountId)
        map.set(t.toAccountId, (map.get(t.toAccountId) ?? 0) + arrived)
      }
    } else {
      map.set(t.accountId, (map.get(t.accountId) ?? 0) + (t.type === 'expense' ? -1 : 1) * inAccount(t, t.accountId))
    }
  }
  return map
}

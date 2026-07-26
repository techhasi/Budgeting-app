/**
 * Investment valuation helpers — everything in the investment's own currency
 * (minor units), so callers can `toLKR(..., inv.currency, usdRate)` for net worth.
 *
 *  • Fixed deposits grow linearly from principal → maturity value over the term.
 *  • Market assets (crypto/gold/stocks) are valued at quantity × live price.
 */

import { type Investment } from '../db/db'
import { convertMinor } from './money'
import { goldQtyToOz } from './prices'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime()
  const b = new Date(`${toISO}T00:00:00`).getTime()
  return (b - a) / 86_400_000
}

function fdStartISO(inv: Investment): string {
  if (inv.startDate) return inv.startDate
  const d = new Date(inv.updatedAt || Date.now())
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Projected value of an FD at maturity (explicit, else simple-interest estimate). */
export function fdMaturityMinor(inv: Investment): number | null {
  if (inv.maturityAmountMinor != null) return inv.maturityAmountMinor
  if (inv.interestRate != null && inv.maturityDate && inv.valueMinor) {
    const years = daysBetween(fdStartISO(inv), inv.maturityDate) / 365
    if (years <= 0) return inv.valueMinor
    return Math.round(inv.valueMinor * (1 + (inv.interestRate / 100) * years))
  }
  return null
}

/** FD value accrued to today, interpolating principal → maturity linearly. */
export function fdAccruedMinor(inv: Investment, today = todayISO()): number {
  const maturity = fdMaturityMinor(inv)
  if (maturity == null || !inv.maturityDate) return inv.valueMinor
  const start = fdStartISO(inv)
  const total = daysBetween(start, inv.maturityDate)
  if (total <= 0) return maturity
  const frac = Math.min(1, Math.max(0, daysBetween(start, today) / total))
  return Math.round(inv.valueMinor + (maturity - inv.valueMinor) * frac)
}

/** Live market value in the investment's currency (minor), or null if not priced. */
export function marketValueMinor(inv: Investment, usdRate: number): number | null {
  if (inv.livePriceMinor == null || inv.quantity == null) return null
  const units = inv.type === 'gold' ? goldQtyToOz(inv.quantity, inv.unit) : inv.quantity
  const usdMinor = Math.round(units * inv.livePriceMinor)
  return convertMinor(usdMinor, 'USD', inv.currency, usdRate)
}

/** Current value used for net worth, in the investment's currency (minor units). */
export function currentValueMinor(inv: Investment, usdRate: number): number {
  if (inv.type === 'fd') return fdAccruedMinor(inv)
  return marketValueMinor(inv, usdRate) ?? inv.valueMinor
}

/** Profit/loss vs cost basis (minor, investment currency), or null if no basis. */
export function profitMinor(inv: Investment, usdRate: number): number | null {
  const market = marketValueMinor(inv, usdRate)
  if (market == null || inv.costBasisMinor == null) return null
  return market - inv.costBasisMinor
}

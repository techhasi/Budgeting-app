/**
 * Live market prices for investments — all client-side, no backend.
 *
 *  • Crypto  → CoinGecko public API (keyless, CORS-enabled). `symbol` holds the
 *              CoinGecko coin id, e.g. "bitcoin", "ethereum".
 *  • Gold    → Twelve Data `XAU/USD` (price per troy ounce, USD). Needs a free key.
 *  • Stocks  → Twelve Data by ticker, e.g. "AAPL", "VOO". Needs the same free key.
 *
 * Everything is returned as USD per unit; the caller converts to the account
 * currency. Gold quantity may be held in grams / sovereigns, converted here.
 */

import type { Investment } from '../db/db'

/** 1 troy ounce in grams. */
const GRAMS_PER_OZ = 31.1034768
/** A Sri Lankan gold sovereign ("pawn"/පවුම) is 8 g. */
const GRAMS_PER_SOVEREIGN = 8

/** Convert a held gold quantity (in `unit`) to troy ounces for USD/oz pricing. */
export function goldQtyToOz(quantity: number, unit: string | undefined): number {
  switch (unit) {
    case 'g':
      return quantity / GRAMS_PER_OZ
    case 'sovereign':
      return (quantity * GRAMS_PER_SOVEREIGN) / GRAMS_PER_OZ
    case 'oz':
    default:
      return quantity
  }
}

export class PriceError extends Error {}

async function fetchCryptoPriceUSD(coinId: string): Promise<number> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd`
  const res = await fetch(url)
  if (!res.ok) throw new PriceError(`CoinGecko error ${res.status}`)
  const data = (await res.json()) as Record<string, { usd?: number }>
  const price = data[coinId]?.usd
  if (typeof price !== 'number') throw new PriceError(`Unknown coin "${coinId}"`)
  return price
}

async function fetchTwelveDataPriceUSD(symbol: string, apiKey: string): Promise<number> {
  if (!apiKey) throw new PriceError('Add a market API key in Settings first')
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`
  const res = await fetch(url)
  if (!res.ok) throw new PriceError(`Twelve Data error ${res.status}`)
  const data = (await res.json()) as { price?: string; code?: number; message?: string }
  if (data.code || data.message) throw new PriceError(data.message ?? 'Price lookup failed')
  const price = Number(data.price)
  if (!isFinite(price) || price <= 0) throw new PriceError(`No price for "${symbol}"`)
  return price
}

/** Fetch the current USD price for one unit of this investment's asset. */
export async function fetchPriceUSD(inv: Pick<Investment, 'type' | 'symbol'>, apiKey: string): Promise<number> {
  const symbol = (inv.symbol ?? '').trim()
  if (!symbol && inv.type !== 'gold') throw new PriceError('Add a symbol / coin id first')
  switch (inv.type) {
    case 'crypto':
      return fetchCryptoPriceUSD(symbol.toLowerCase())
    case 'gold':
      return fetchTwelveDataPriceUSD(symbol || 'XAU/USD', apiKey)
    case 'stocks':
      return fetchTwelveDataPriceUSD(symbol.toUpperCase(), apiKey)
    default:
      throw new PriceError('This investment type has no live price')
  }
}

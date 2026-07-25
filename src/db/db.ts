import Dexie, { type EntityTable } from 'dexie'

export type Currency = 'LKR' | 'USD'
export type TxnType = 'expense' | 'income' | 'transfer'
/** Types that have a category and count toward totals (i.e. not transfers). */
export type CategoryKind = 'expense' | 'income'
export type Theme = 'system' | 'light' | 'dark'

export interface Category {
  id: string
  name: string
  emoji: string
  color: string
  kind: CategoryKind
  builtin?: boolean
  /** expense categories only: monthly budget in LKR minor units (unset = no budget) */
  budgetMinor?: number
}

export type AccountType = 'cash' | 'bank' | 'debit' | 'credit'

export interface Account {
  id: string
  name: string
  type: AccountType
  color: string
  /** account's own currency; balances are kept in it (default LKR) */
  currency?: Currency
  /** opening balance in minor units of the account's currency */
  openingMinor: number
  /** last 3-4 digits of the card/account, used to auto-match SMS imports */
  numberHint?: string
  /** credit cards: this month's statement amount due (LKR minor); unset = use outstanding balance */
  statementMinor?: number
  /** credit cards: "YYYY-MM" when the bill was last marked paid, hides the due reminder */
  lastPaidMonth?: string
  /** credit cards: credit limit (LKR minor), used to show available credit */
  creditLimitMinor?: number
}

export interface Txn {
  id: string
  type: TxnType
  /** amount in minor units (cents) of `currency` */
  amountMinor: number
  currency: Currency
  /** empty string for transfers (no category) */
  categoryId: string
  /** source account for expenses/transfers, destination for income */
  accountId: string
  /** transfers only: destination account */
  toAccountId?: string
  /** transfers only: amount arriving in the destination account's currency
   *  (differs from amountMinor for cross-currency transfers) */
  toAmountMinor?: number
  /** ISO date YYYY-MM-DD */
  date: string
  note: string
  /** income only: this txn (salary) started a new budget period */
  startsPeriod?: boolean
  /** balance correction: affects account balances but not spending/earning totals */
  adjustment?: boolean
  createdAt: number
}

export interface Receipt {
  txnId: string
  blob: Blob
}

export interface Period {
  id: string
  /** ISO date YYYY-MM-DD (inclusive) */
  startDate: string
  /** ISO date YYYY-MM-DD (inclusive), null = currently active */
  endDate: string | null
  /** balance carried in from previous period, LKR minor units */
  carryInMinor: number
}

export interface Settings {
  id: 'app'
  currency: Currency
  theme: Theme
  carryOver: boolean
  /** manual LKR per 1 USD rate used to convert USD txns in totals */
  usdRate: number
  /** cloud backup: private GitHub repo "owner/name" + fine-grained PAT */
  backupRepo?: string
  backupToken?: string
  /** last day a daily cloud backup succeeded (ISO date) */
  lastBackupDay?: string
  /** startDate of the last budget cycle snapshotted to the cloud */
  lastCycleBackup?: string
  /** Face ID app lock (WebAuthn platform credential), device-specific */
  lockEnabled?: boolean
  lockCredentialId?: string
  /** Google Calendar OAuth client id (public), for the tasks calendar overlay */
  gcalClientId?: string
  /** account auto-selected when adding an expense / income */
  defaultExpenseAccountId?: string
  defaultIncomeAccountId?: string
}

export type Priority = 'none' | 'low' | 'medium' | 'high'
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'

export interface Subtask {
  id: string
  title: string
  done: boolean
}

/** A to-do task in the Tasks section. */
export interface Task {
  id: string
  title: string
  notes: string
  done: boolean
  completedAt?: number
  /** ISO date YYYY-MM-DD */
  dueDate?: string
  /** HH:MM (24h) */
  dueTime?: string
  priority: Priority
  /** owning list/project, or null for the inbox */
  listId: string | null
  subtasks: Subtask[]
  recurrence: Recurrence
  /** manual sort order within a day/list */
  order: number
  createdAt: number
}

/** A task list / project. */
export interface TaskList {
  id: string
  name: string
  emoji: string
  color: string
  order: number
}

/** A repeating payment: subscription/bill, or a loan with payoff tracking. */
export interface Recurring {
  id: string
  name: string
  kind: 'subscription' | 'loan'
  /** installment amount in minor units of `currency` */
  amountMinor: number
  currency: Currency
  categoryId: string
  accountId: string
  /** 1-31, clamped to shorter months */
  dayOfMonth: number
  /** 1 = monthly, 3 = quarterly, 12 = yearly */
  intervalMonths: number
  /** next occurrence (ISO date) */
  nextDue: string
  note: string
  /** loans: total to repay / repaid so far, minor units of `currency` */
  principalMinor?: number
  paidMinor?: number
  createdAt: number
}

export interface Investment {
  id: string
  name: string
  type: 'savings' | 'fd' | 'stocks' | 'crypto' | 'epf' | 'other'
  /** current value in minor units of `currency` */
  valueMinor: number
  currency: Currency
  note: string
  updatedAt: number
}

/** A bank-SMS candidate awaiting user approval in the import inbox. */
export interface PendingTxn {
  id: string
  raw: string
  type: CategoryKind
  amountMinor: number
  currency: Currency
  date: string
  merchant: string
  accountHint: string | null
  /** bank-stated available balance from the SMS, for reconciliation */
  balanceMinor?: number
  balanceCurrency?: Currency
  createdAt: number
}

export const db = new Dexie('budget-app') as Dexie & {
  txns: EntityTable<Txn, 'id'>
  categories: EntityTable<Category, 'id'>
  accounts: EntityTable<Account, 'id'>
  receipts: EntityTable<Receipt, 'txnId'>
  periods: EntityTable<Period, 'id'>
  settings: EntityTable<Settings, 'id'>
  pending: EntityTable<PendingTxn, 'id'>
  recurring: EntityTable<Recurring, 'id'>
  investments: EntityTable<Investment, 'id'>
  tasks: EntityTable<Task, 'id'>
  taskLists: EntityTable<TaskList, 'id'>
}

db.version(1).stores({
  txns: 'id, date, type, categoryId, accountId',
  categories: 'id, kind',
  accounts: 'id',
  receipts: 'txnId',
  periods: 'id, startDate',
  settings: 'id'
})

db.version(2).stores({
  pending: 'id, createdAt'
})

db.version(3).stores({
  recurring: 'id, nextDue',
  investments: 'id'
})

db.version(4).stores({
  tasks: 'id, listId, dueDate, done, order',
  taskLists: 'id, order'
})

export const uid = () => crypto.randomUUID()

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  currency: 'LKR',
  theme: 'dark',
  carryOver: true,
  usdRate: 300,
  // Default backup destination; the token is entered once per install in
  // Settings and lives only in IndexedDB (never in code — the repo is public).
  backupRepo: 'techhasi/hasikasi-backups'
}

const DEFAULT_EXPENSE_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Food', emoji: '🍔', color: '#f97316', kind: 'expense', builtin: true },
  { name: 'Groceries', emoji: '🛒', color: '#84cc16', kind: 'expense', builtin: true },
  { name: 'Transport', emoji: '🚕', color: '#eab308', kind: 'expense', builtin: true },
  { name: 'Bills', emoji: '⚡', color: '#06b6d4', kind: 'expense', builtin: true },
  { name: 'Shopping', emoji: '🛍️', color: '#ec4899', kind: 'expense', builtin: true },
  { name: 'Health', emoji: '💊', color: '#ef4444', kind: 'expense', builtin: true },
  { name: 'Entertainment', emoji: '🎬', color: '#8b5cf6', kind: 'expense', builtin: true },
  { name: 'Education', emoji: '📚', color: '#3b82f6', kind: 'expense', builtin: true },
  { name: 'Other', emoji: '📦', color: '#64748b', kind: 'expense', builtin: true }
]

const DEFAULT_INCOME_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Salary', emoji: '💼', color: '#10b981', kind: 'income', builtin: true },
  { name: 'Freelance', emoji: '💻', color: '#6366f1', kind: 'income', builtin: true },
  { name: 'Interest', emoji: '🏦', color: '#0ea5e9', kind: 'income', builtin: true },
  { name: 'Gift', emoji: '🎁', color: '#f43f5e', kind: 'income', builtin: true },
  { name: 'Other', emoji: '💰', color: '#64748b', kind: 'income', builtin: true }
]

/** Seed defaults on first run; safe to call every launch. */
export async function initDb() {
  await db.transaction('rw', [db.categories, db.accounts, db.settings, db.periods, db.taskLists], async () => {
    const existing = await db.settings.get('app')
    if (!existing) {
      await db.settings.add(DEFAULT_SETTINGS)
    } else if (!existing.backupRepo) {
      await db.settings.update('app', { backupRepo: DEFAULT_SETTINGS.backupRepo })
    }
    if ((await db.taskLists.count()) === 0) {
      await db.taskLists.bulkAdd([
        { id: uid(), name: 'Personal', emoji: '🏡', color: '#6366f1', order: 0 },
        { id: uid(), name: 'Work', emoji: '💼', color: '#0ea5e9', order: 1 },
        { id: uid(), name: 'Shopping', emoji: '🛒', color: '#f59e0b', order: 2 }
      ])
    }
    if ((await db.categories.count()) === 0) {
      await db.categories.bulkAdd(
        [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES].map(c => ({ ...c, id: uid() }))
      )
    }
    if ((await db.accounts.count()) === 0) {
      await db.accounts.add({ id: uid(), name: 'Cash', type: 'cash', color: '#10b981', openingMinor: 0 })
    } else {
      // Migrate legacy generic 'card' accounts to 'credit' (statement/due features target credit cards)
      const legacy = (await db.accounts.toArray()).filter(a => (a.type as string) === 'card')
      for (const a of legacy) await db.accounts.update(a.id, { type: 'credit' })
    }
    if ((await db.periods.count()) === 0) {
      // Initial period starts on the 1st of the current month; the first
      // salary entry will close it and start the real salary-cycle.
      const now = new Date()
      const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      await db.periods.add({ id: uid(), startDate: first, endDate: null, carryInMinor: 0 })
    }
  })
}

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get('app')) ?? DEFAULT_SETTINGS
}

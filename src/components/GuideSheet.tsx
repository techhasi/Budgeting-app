import Sheet from './Sheet'

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '🗓️ Budget months',
    body: [
      'HasiKasi doesn\'t use calendar months. A "month" runs from one salary to the day before the next.',
      'When you add an income with the Salary category, a toggle starts a new budget month from that date. Leftover money rolls into the new month if Carry over is on (Settings).'
    ]
  },
  {
    title: '➕ Adding transactions',
    body: [
      'Tap the big + button. Pick Expense, Income, or Transfer (moving money between accounts — doesn\'t count as spending).',
      'Paying a credit card bill is a Transfer (bank → card), not an expense — it just settles debt you already recorded when you spent on the card. Logging it as an expense would double-count. For different-currency accounts, a transfer also asks for the amount received.',
      'Expenses can have a receipt photo attached. Create your own categories with the ＋ New button in the category grid.',
      'If a similar transaction (same amount, ±2 days) exists, you\'ll get a duplicate warning — tap "Add anyway" if it\'s genuinely new.',
      'Tap any transaction in the list to view, edit, or delete it.'
    ]
  },
  {
    title: '📥 SMS import & balance sync',
    body: [
      'Copy bank SMS messages and tap the 📥 button on Home, then "Paste & scan". Detected transactions wait in an inbox for your approval.',
      'Set the last 4 digits on each account (Accounts → tap account) so imports pick the right account automatically.',
      'If the SMS states your available balance, approving the transaction auto-syncs the account: any difference from the app\'s balance is logged as an ⚖️ Adjustment.',
      'For automation: create an iOS Shortcut that copies bank SMS to the clipboard when they arrive (guide inside the import screen).'
    ]
  },
  {
    title: '⚖️ Balance adjustments',
    body: [
      'Adjustments correct an account\'s balance to match the real world — created automatically from SMS balances, or manually via the "actual balance now" field when editing an account.',
      'They only affect account balances: spending/earning totals, budgets, stats and carry-over ignore them, so corrections never distort your budget months.'
    ]
  },
  {
    title: '🎯 Budgets',
    body: [
      'In Stats → Spending, tap a category to set a monthly limit. Progress bars appear on Home and in Stats — amber past 85%, red when over.'
    ]
  },
  {
    title: '🔁 Recurring, loans & card bills',
    body: [
      'Add rent, subscriptions, and loan installments in Accounts → Recurring & loans. They appear on Home from 5 days before they\'re due — Log ✓ records the expense, Skip moves to next cycle. Loans show payoff progress.',
      'Paying early? Tap the item in Accounts → Recurring & loans: "Log now" records an installment any time, and loans have a "Pay off remaining" button for full early settlement.',
      'Credit cards: the amount due is your monthly statement — revolving balance plus one installment for any loans on the card — due by month-end. Pay ✓ records one bank→card transfer and advances those loans automatically; Dismiss marks it paid without logging. Set up an installment plan as a Loan (Accounts → Recurring & loans) with its account set to the card.'
    ]
  },
  {
    title: '💳 Accounts, cards & net worth',
    body: [
      'Four account types: Cash, Bank, Debit card (works like bank money), and Credit card (a debt you owe).',
      'Tap any account to see its salary cycle — what you spent, what you earned, and every transaction (including transfers in/out). Use ‹ › to step through previous cycles. The Edit button opens the account settings.',
      'Credit cards show negative balances as you spend — that\'s money owed, and it correctly reduces net worth. Enter existing debt as a negative opening balance (e.g. -45000).',
      'Set a credit limit on each credit card to see remaining available credit and a limit-usage bar (amber past 70%, red past 90%).',
      'Investments & savings (FDs, stocks, crypto, gold, EPF) are tracked separately and count toward net worth. Tap one to update it.',
      'Fixed deposits: set the principal, interest rate (or maturity value) and dates, and net worth grows gradually toward maturity. Optionally fund it from an account (the principal is moved out so nothing is double-counted) and get a maturity reminder.',
      'Gold, crypto & stocks: enter the quantity held and what you paid, then tap Fetch live price — HasiKasi shows current value and profit/loss. Use ↻ Prices to refresh them all. Crypto is free; gold and stocks need a free Twelve Data key (Settings → Market data).'
    ]
  },
  {
    title: '☁️ Backups',
    body: [
      'Your data lives only on this device. Two safety nets:',
      '1. Settings → Export backup: downloads everything as a JSON file (keep one in iCloud Files).',
      '2. Cloud backup: connects a private GitHub repo — a daily backup plus one snapshot per budget month, automatic when you open the app.',
      'Restore: pick a local file (Data → Restore backup) or pull straight from the cloud (Cloud backup → Restore). Either replaces all current data; your backup token and Face ID lock stay untouched.'
    ]
  },
  {
    title: '🔔 Reminders',
    body: [
      'Tap the 🔔 bell on the Overview screen to add dated reminders (rent, FD renewal, anything). A red badge counts what is due today or overdue.',
      'For a real lock-screen alert on iPhone, tick “Also add to Google Calendar” — the reminder becomes a calendar event so iOS notifies you natively. (A home-screen PWA can\'t fire its own background alerts, so this is the reliable path.) Connect Google in Settings → Google Calendar first.',
      'FD maturity reminders are created automatically when you tick the option on a fixed deposit.',
      'Also available: daily/salary-week email reminders via GitHub Actions, and an iOS Shortcuts daily nudge — both set up in Settings → Reminders.'
    ]
  },
  {
    title: '✅ Tasks & calendar',
    body: [
      'The Tasks tab is a full to-do list: add tasks with due dates, times, priorities, lists, checklists and repeat rules. Tap the checkbox to complete (repeating tasks roll to their next date).',
      'Views: Today (overdue + due today), Upcoming, All, and a Calendar month view. Filter by list, or search.',
      'Calendar can overlay your Google Calendar (read-only) — add a Google client id in Settings → Google Calendar, then tap Connect on the calendar view.'
    ]
  },
  {
    title: '⚠️ Important',
    body: [
      'Always open HasiKasi from the home-screen icon. Safari tabs keep a separate copy of data.',
      'Amounts are in LKR by default; USD entries are converted using the rate in Settings for totals.'
    ]
  }
]

/** In-app "how it works" guide, opened from Settings. */
export default function GuideSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet onClose={onClose} title="📖 How HasiKasi works">
      <div className="space-y-4">
        {SECTIONS.map(s => (
          <div key={s.title} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <h3 className="mb-1.5 text-sm font-bold">{s.title}</h3>
            {s.body.map((line, i) => (
              <p key={i} className="mb-1 text-xs leading-relaxed text-slate-500 last:mb-0 dark:text-slate-400">
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
    </Sheet>
  )
}

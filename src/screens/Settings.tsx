import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, type Account, type Settings } from '../db/db'
import { exportBackup, importBackup } from '../lib/backup'
import { autoBackup, normalizeRepo } from '../lib/cloudBackup'
import { lockSupported, enrollLock, verifyLock } from '../lib/appLock'
import { ENV_GCAL_CLIENT_ID, ENV_MARKET_KEY } from '../lib/env'
import GuideSheet from '../components/GuideSheet'
import CloudRestoreSheet from '../components/CloudRestoreSheet'

export default function SettingsScreen() {
  const settings = useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS)
  const accounts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const importRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [guideOpen, setGuideOpen] = useState(false)
  const [cloudRestoreOpen, setCloudRestoreOpen] = useState(false)

  if (!settings) return null

  async function update(patch: Partial<Settings>) {
    await db.settings.update('app', patch)
  }

  async function onImport(file: File) {
    try {
      await importBackup(file)
      setMessage('✅ Backup restored')
    } catch (e) {
      setMessage(`❌ ${e instanceof Error ? e.message : 'Import failed'}`)
    }
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Settings</h1>

      <button
        onClick={() => setGuideOpen(true)}
        className="mb-5 flex w-full items-center justify-between rounded-3xl bg-gradient-to-r from-indigo-500 to-purple-600 p-4 text-white shadow-lg shadow-indigo-500/30"
      >
        <span className="text-sm font-bold">📖 How HasiKasi works</span>
        <span className="text-lg">›</span>
      </button>

      <Section title="Preferences">
        <Row label="Default currency" hint="Used when adding transactions">
          <Segmented
            value={settings.currency}
            options={['LKR', 'USD']}
            onChange={v => update({ currency: v as Settings['currency'] })}
          />
        </Row>
        <Row label="Theme">
          <Segmented
            value={settings.theme}
            options={['system', 'light', 'dark']}
            onChange={v => update({ theme: v as Settings['theme'] })}
          />
        </Row>
        <Row label="Primary card" hint="Auto-selected when adding an expense">
          <AccountSelect
            value={settings.defaultExpenseAccountId}
            accounts={accounts}
            onChange={id => update({ defaultExpenseAccountId: id })}
          />
        </Row>
        <Row label="Primary account" hint="Auto-selected when adding income">
          <AccountSelect
            value={settings.defaultIncomeAccountId}
            accounts={accounts}
            onChange={id => update({ defaultIncomeAccountId: id })}
          />
        </Row>
        <Row label="Carry over balance" hint="Roll leftover money into the next budget month">
          <Toggle checked={settings.carryOver} onChange={v => update({ carryOver: v })} />
        </Row>
        <Row label="App lock" hint="Require Face ID when opening the app">
          <Toggle
            checked={!!settings.lockEnabled}
            onChange={async on => {
              if (on) {
                if (!lockSupported()) return setMessage('❌ Face ID / passkeys not available on this device')
                try {
                  const id = await enrollLock()
                  await update({ lockEnabled: true, lockCredentialId: id })
                  setMessage('✅ App lock enabled')
                } catch (e) {
                  setMessage(`❌ ${e instanceof Error ? e.message : 'Face ID setup failed'}`)
                }
              } else {
                // Turning the lock off requires passing it first
                try {
                  if (settings.lockCredentialId && (await verifyLock(settings.lockCredentialId))) {
                    await update({ lockEnabled: false, lockCredentialId: undefined })
                    setMessage('App lock disabled')
                  } else {
                    setMessage('❌ Authentication failed')
                  }
                } catch {
                  setMessage('❌ Authentication failed')
                }
              }
            }}
          />
        </Row>
        <Row label="USD rate" hint="LKR per 1 USD, used for totals">
          <UsdRateInput value={settings.usdRate} onSave={n => update({ usdRate: n })} />
        </Row>
      </Section>

      <Section title="Reminders">
        <div className="px-4 py-3.5">
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium">
              🔔 Daily notification on iPhone
              <span className="ml-1 text-xs text-slate-400">(2-min setup, no accounts)</span>
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <li>Open the <b>Shortcuts</b> app → <b>Automation</b> tab → <b>+</b></li>
              <li>Choose <b>Time of Day</b> → set e.g. 9:00 PM, Daily → <b>Next</b></li>
              <li>Pick <b>New Blank Automation</b> → <b>Add Action</b> → search <b>Show Notification</b></li>
              <li>Set the text to “Time to log today's spending 📝” → tap <b>Done</b></li>
              <li>Select <b>Run Immediately</b> so it fires without asking</li>
            </ol>
          </details>
        </div>
        <div className="border-t border-slate-100 px-4 py-3.5 dark:border-slate-700/50">
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium">
              📧 Email reminders
              <span className="ml-1 text-xs text-slate-400">(daily + salary week)</span>
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              A GitHub Action emails you every evening, plus a salary-week heads-up on the 25th. One-time setup:
            </p>
            <ol className="mt-1.5 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <li>
                In your Google account: <b>Security → 2-Step Verification → App passwords</b> → create one for “HasiKasi”
              </li>
              <li>
                In the GitHub repo: <b>Settings → Secrets and variables → Actions</b> → add three secrets:{' '}
                <b>MAIL_USERNAME</b> (your Gmail), <b>MAIL_PASSWORD</b> (the app password), <b>MAIL_TO</b> (where to receive)
              </li>
              <li>
                Test it: repo <b>Actions → Email reminders → Run workflow</b>
              </li>
            </ol>
            <p className="mt-1.5 text-xs text-slate-400">
              Reminder times can be changed in <code>.github/workflows/reminder.yml</code>.
            </p>
          </details>
        </div>
        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-700/50">
          <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">
            ⚠️ Always open the app from your <b>home-screen icon</b> — Safari keeps separate storage, so
            transactions logged in a Safari tab won't appear here.
          </p>
        </div>
      </Section>

      <Section title="Google Calendar">
        <div className="px-4 py-3.5">
          <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Overlay your Google Calendar events on the Tasks → Calendar view. Read-only, and the browser sign-in lasts
            about an hour, so you tap Connect once per session.
          </p>
          <SyncedInput
            placeholder={ENV_GCAL_CLIENT_ID ? 'Using deploy-time client id (override here)' : 'Google OAuth client id'}
            value={settings.gcalClientId ?? ''}
            onCommit={v => update({ gcalClientId: v.trim() || undefined })}
            className="mb-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
          {ENV_GCAL_CLIENT_ID && !settings.gcalClientId && (
            <p className="mb-2 text-xs text-emerald-600 dark:text-emerald-400">✓ A client id is set from the deploy — leave blank to use it.</p>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-slate-500 dark:text-slate-400">
              One-time setup guide
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <li>Go to <b>console.cloud.google.com</b> → create a project</li>
              <li><b>APIs &amp; Services → Library</b> → enable <b>Google Calendar API</b></li>
              <li>
                <b>OAuth consent screen</b> → External → add yourself as a <b>Test user</b>, add the scopes
                <b> calendar.readonly</b> and <b>calendar.events</b> (events lets HasiKasi push reminders to your calendar)
              </li>
              <li>
                <b>Credentials → Create → OAuth client ID → Web application</b>. Under <b>Authorised JavaScript origins</b>
                add <b>https://techhasi.github.io</b>
              </li>
              <li>Copy the <b>Client ID</b> into the box above, then open Tasks → Calendar → Connect</li>
            </ol>
            <p className="mt-1.5 text-xs text-slate-400">The client id is public; no secret is stored.</p>
          </details>
        </div>
      </Section>

      <Section title="Market data">
        <div className="px-4 py-3.5">
          <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Live prices for <b>gold</b> and <b>stocks</b> come from Twelve Data (free tier). Paste a free API key below.
            Crypto prices work without any key.
          </p>
          <SyncedInput
            type="password"
            placeholder={ENV_MARKET_KEY ? 'Using deploy-time key (override here)' : 'Twelve Data API key'}
            value={settings.marketApiKey ?? ''}
            onCommit={v => update({ marketApiKey: v.trim() || undefined })}
            className="mb-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
          {ENV_MARKET_KEY && !settings.marketApiKey && (
            <p className="mb-2 text-xs text-emerald-600 dark:text-emerald-400">✓ A key is set from the deploy — leave blank to use it.</p>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-slate-500 dark:text-slate-400">
              Where to get a free key
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <li>Go to <b>twelvedata.com</b> → sign up (free)</li>
              <li>Copy the <b>API key</b> from your dashboard</li>
              <li>Paste it above — free tier allows ~800 lookups/day, plenty for a portfolio</li>
            </ol>
            <p className="mt-1.5 text-xs text-slate-400">
              Gold is priced as XAU/USD (per troy ounce); grams and sovereigns are converted for you. The key is
              stored only on this device.
            </p>
          </details>
        </div>
      </Section>

      <Section title="Cloud backup">
        <div className="px-4 py-3.5">
          <p className="mb-1 text-sm font-medium">Automatic off-phone backups</p>
          <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Backs up to a <b>private</b> GitHub repo you own: one daily backup kept up to date, plus a snapshot each
            budget cycle. Runs automatically when you open the app.
          </p>
          <SyncedInput
            placeholder="Repo (e.g. techhasi/hasikasi-backups)"
            value={settings.backupRepo ?? ''}
            onCommit={v => update({ backupRepo: normalizeRepo(v) || undefined })}
            className="mb-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
          <SyncedInput
            type="password"
            placeholder="Fine-grained token (Contents: read/write)"
            value={settings.backupToken ?? ''}
            onCommit={v => update({ backupToken: v.trim() || undefined })}
            className="mb-2 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/60"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-400">
              {settings.lastBackupDay ? `Last backup: ${settings.lastBackupDay}` : 'Not backed up yet'}
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                onClick={() => setCloudRestoreOpen(true)}
                className="rounded-xl bg-slate-200 px-3.5 py-2 text-sm font-semibold dark:bg-slate-700"
              >
                Restore
              </button>
              <button
                onClick={async () => {
                  setMessage('⏳ Backing up…')
                  try {
                    setMessage((await autoBackup(true)) ?? 'Nothing to back up')
                  } catch (e) {
                    setMessage(`❌ ${e instanceof Error ? e.message : 'Backup failed'}`)
                  }
                }}
                className="rounded-xl bg-indigo-500 px-3.5 py-2 text-sm font-semibold text-white"
              >
                Back up now
              </button>
            </div>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-500 dark:text-slate-400">
              One-time setup guide
            </summary>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <li>On GitHub create a <b>private</b> repo, e.g. <b>hasikasi-backups</b> (initialize with a README)</li>
              <li>
                GitHub → Settings → Developer settings → <b>Fine-grained tokens</b> → Generate: repository access ={' '}
                <b>only that repo</b>, permission <b>Contents: Read and write</b>, long expiration
              </li>
              <li>Paste repo and token above, then tap <b>Back up now</b> to test</li>
            </ol>
            <p className="mt-1.5 text-xs text-slate-400">
              The token is stored only on this device and is never included inside backup files.
            </p>
          </details>
        </div>
      </Section>

      <Section title="Data">
        <Row label="Export backup" hint="Download all data as a JSON file">
          <button onClick={() => exportBackup()} className="rounded-xl bg-indigo-500 px-3.5 py-2 text-sm font-semibold text-white">
            Export
          </button>
        </Row>
        <Row label="Restore backup" hint="Replaces all current data">
          <input
            ref={importRef}
            type="file"
            accept="application/json"
            hidden
            onChange={e => e.target.files?.[0] && onImport(e.target.files[0])}
          />
          <button
            onClick={() => importRef.current?.click()}
            className="rounded-xl bg-slate-200 px-3.5 py-2 text-sm font-semibold dark:bg-slate-700"
          >
            Import
          </button>
        </Row>
      </Section>

      {message && <p className="mb-4 text-center text-sm font-medium">{message}</p>}

      <p className="pb-4 text-center text-xs text-slate-400">
        HasiKasi · local-first · your data never leaves this device
      </p>

      {guideOpen && <GuideSheet onClose={() => setGuideOpen(false)} />}
      {cloudRestoreOpen && <CloudRestoreSheet onClose={() => setCloudRestoreOpen(false)} />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
      <div className="overflow-hidden rounded-3xl bg-white shadow-sm dark:bg-slate-800/60">{children}</div>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 last:border-0 dark:border-slate-700/50">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-slate-400">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Segmented({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="flex shrink-0 rounded-xl bg-slate-100 p-0.5 dark:bg-slate-700/60">
      {options.map(o => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-[10px] px-2.5 py-1.5 text-xs font-semibold capitalize transition-all ${
            value === o ? 'bg-white text-indigo-600 shadow dark:bg-slate-900 dark:text-indigo-400' : 'text-slate-500'
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
    >
      <span
        className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`}
      />
    </button>
  )
}

/** Controlled text input that stays in sync with async-loaded settings and saves live. */
function SyncedInput({
  value,
  onCommit,
  ...rest
}: { value: string; onCommit: (v: string) => void } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  // Adopt the loaded value only while the field isn't being edited
  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])
  return (
    <input
      {...rest}
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={e => {
        setText(e.target.value)
        onCommit(e.target.value)
      }}
      onBlur={() => (focused.current = false)}
    />
  )
}

function AccountSelect({ value, accounts, onChange }: { value?: string; accounts: Account[]; onChange: (id: string | undefined) => void }) {
  return (
    <select
      value={value && accounts.some(a => a.id === value) ? value : ''}
      onChange={e => onChange(e.target.value || undefined)}
      className="max-w-[9.5rem] truncate rounded-xl border border-slate-200 bg-slate-50 p-2 text-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <option value="">First account</option>
      {accounts.map(a => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  )
}

function UsdRateInput({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(String(value))
  }, [value])
  return (
    <input
      inputMode="decimal"
      value={text}
      onFocus={() => (focused.current = true)}
      onChange={e => {
        setText(e.target.value)
        const n = parseFloat(e.target.value)
        if (Number.isFinite(n) && n > 0) onSave(n)
      }}
      onBlur={() => {
        focused.current = false
        const n = parseFloat(text)
        if (!Number.isFinite(n) || n <= 0) setText(String(value))
      }}
      className="w-20 rounded-xl border border-slate-200 bg-slate-50 p-2 text-right text-sm tabular-nums dark:border-slate-700 dark:bg-slate-800"
    />
  )
}

import { db } from '../db/db'
import { blobToDataURL, dataURLToBlob } from './image'

interface BackupFile {
  app: 'budgeting-app'
  version: 1
  exportedAt: string
  txns: unknown[]
  categories: unknown[]
  accounts: unknown[]
  periods: unknown[]
  settings: unknown[]
  recurring?: unknown[]
  investments?: unknown[]
  tasks?: unknown[]
  taskLists?: unknown[]
  reminders?: unknown[]
  receipts: { txnId: string; dataUrl: string }[]
}

export async function buildBackup(): Promise<BackupFile> {
  const receipts = await db.receipts.toArray()
  // Device-specific secrets are excluded: the cloud token (sensitive) and the
  // Face ID lock (its credential wouldn't exist on a restore target device)
  const settings = (await db.settings.toArray()).map(s => ({
    ...s,
    backupToken: undefined,
    lockEnabled: undefined,
    lockCredentialId: undefined
  }))
  return {
    app: 'budgeting-app',
    version: 1,
    exportedAt: new Date().toISOString(),
    txns: await db.txns.toArray(),
    categories: await db.categories.toArray(),
    accounts: await db.accounts.toArray(),
    periods: await db.periods.toArray(),
    settings,
    recurring: await db.recurring.toArray(),
    investments: await db.investments.toArray(),
    tasks: await db.tasks.toArray(),
    taskLists: await db.taskLists.toArray(),
    reminders: await db.reminders.toArray(),
    receipts: await Promise.all(
      receipts.map(async r => ({ txnId: r.txnId, dataUrl: await blobToDataURL(r.blob) }))
    )
  }
}

export async function exportBackup(): Promise<void> {
  const backup = await buildBackup()
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `budget-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export async function importBackup(file: File): Promise<void> {
  return importBackupData(JSON.parse(await file.text()) as BackupFile)
}

export async function importBackupData(backup: BackupFile): Promise<void> {
  if (backup.app !== 'budgeting-app') throw new Error('Not a HasiKasi backup file')
  const receipts = await Promise.all(
    backup.receipts.map(async r => ({ txnId: r.txnId, blob: await dataURLToBlob(r.dataUrl) }))
  )
  // Device-specific secrets are not in backups — carry the current ones across
  const current = await db.settings.get('app')
  await db.transaction(
    'rw',
    [db.txns, db.categories, db.accounts, db.periods, db.settings, db.receipts, db.recurring, db.investments, db.tasks, db.taskLists, db.reminders],
    async () => {
      await Promise.all([
        db.txns.clear(), db.categories.clear(), db.accounts.clear(),
        db.periods.clear(), db.settings.clear(), db.receipts.clear(),
        db.recurring.clear(), db.investments.clear(), db.tasks.clear(), db.taskLists.clear(), db.reminders.clear()
      ])
      await db.txns.bulkAdd(backup.txns as never[])
      await db.categories.bulkAdd(backup.categories as never[])
      await db.accounts.bulkAdd(backup.accounts as never[])
      await db.periods.bulkAdd(backup.periods as never[])
      await db.settings.bulkAdd(backup.settings as never[])
      if (backup.recurring) await db.recurring.bulkAdd(backup.recurring as never[])
      if (backup.investments) await db.investments.bulkAdd(backup.investments as never[])
      if (backup.tasks) await db.tasks.bulkAdd(backup.tasks as never[])
      if (backup.taskLists) await db.taskLists.bulkAdd(backup.taskLists as never[])
      if (backup.reminders) await db.reminders.bulkAdd(backup.reminders as never[])
      await db.receipts.bulkAdd(receipts)
      if (current) {
        await db.settings.update('app', {
          backupToken: current.backupToken,
          lockEnabled: current.lockEnabled,
          lockCredentialId: current.lockCredentialId
        })
      }
    }
  )
}

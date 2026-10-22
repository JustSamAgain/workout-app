// Backup reminder.
//
// A backup is a full export (all exercises and workouts). The reminder shows when
// - there is data, and it has not been snoozed ("Later"), and
// - there was never a backup and the first data is older than FIRST_BACKUP_DAYS, or
// - the last backup is older than BACKUP_DAYS and something changed since then.

import { repo } from './db.js';

export const BACKUP_DAYS = 30;
export const FIRST_BACKUP_DAYS = 7;
export const SNOOZE_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;
const time = (iso) => (iso ? Date.parse(iso) : NaN);

export async function backupStatus() {
  const [exercises, workouts, lastBackupAt, lastChangeAt, snoozedUntil] = await Promise.all([
    repo.listExercises(),
    repo.listWorkouts(),
    repo.getMeta('lastBackupAt'),
    repo.getMeta('lastChangeAt'),
    repo.getMeta('backupSnoozedUntil'),
  ]);
  const records = [...exercises, ...workouts];
  const hasData = records.length > 0;
  const now = Date.now();

  // Before this feature existed, changes were not tracked: fall back to the newest record.
  const lastChange = Number.isFinite(time(lastChangeAt))
    ? time(lastChangeAt)
    : Math.max(0, ...records.map((r) => time(r.updatedAt)).filter(Number.isFinite));
  const firstData = Math.min(now, ...records.map((r) => time(r.createdAt)).filter(Number.isFinite));
  const last = time(lastBackupAt);
  const snoozed = time(snoozedUntil) > now;

  let due = false;
  if (hasData && !snoozed) {
    if (!Number.isFinite(last)) due = now - firstData > FIRST_BACKUP_DAYS * DAY;
    else due = now - last > BACKUP_DAYS * DAY && lastChange > last;
  }
  return {
    hasData,
    due,
    lastBackupAt: Number.isFinite(last) ? lastBackupAt : null,
    daysSince: Number.isFinite(last) ? Math.floor((now - last) / DAY) : null,
  };
}

export async function recordBackup() {
  await repo.setMeta('lastBackupAt', new Date().toISOString());
  await repo.setMeta('backupSnoozedUntil', null);
}

export function snoozeBackup() {
  return repo.setMeta('backupSnoozedUntil', new Date(Date.now() + SNOOZE_DAYS * DAY).toISOString());
}

export function daysAgo(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

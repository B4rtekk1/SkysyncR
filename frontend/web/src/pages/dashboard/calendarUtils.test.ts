import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CALENDAR_ENTRIES_STORAGE_KEY,
  entryKey,
  fromApiEntry,
  isCalendarKind,
  loadCalendarEntries,
  parseDateKey,
  startOfWeek,
  toDateKey,
} from './calendarUtils.ts'

const storageValues = new Map<string, string>()
const storage = {
  getItem: (key: string): string | null => storageValues.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    storageValues.set(key, value)
  },
  clear: (): void => {
    storageValues.clear()
  },
}
Object.assign(globalThis, { localStorage: storage })

test.beforeEach(() => {
  storage.clear()
})

test('date key helpers use local calendar dates with Monday week starts', () => {
  assert.equal(toDateKey(new Date(2026, 6, 5)), '2026-07-05')
  assert.equal(toDateKey(parseDateKey('2026-07-18')), '2026-07-18')
  assert.equal(toDateKey(startOfWeek(new Date(2026, 6, 5))), '2026-06-29')
})

test('loadCalendarEntries keeps valid entries and normalizes missing fileId to null', () => {
  storage.setItem(
    CALENDAR_ENTRIES_STORAGE_KEY,
    JSON.stringify([
      { id: '1', kind: 'event', date: '2026-07-18', time: '09:30', title: 'Sync', note: '', reminder: '' },
      { id: '2', kind: 'unknown', date: '2026-07-18', time: '09:30', title: 'Bad', note: '', reminder: '' },
      { id: '3', kind: 'deadline', date: '2026-07-19', time: '12:00', title: 'Submit', note: 'Done', reminder: '1h', fileId: 'file-1' },
    ]),
  )

  assert.deepEqual(loadCalendarEntries(), [
    { id: '1', kind: 'event', date: '2026-07-18', time: '09:30', title: 'Sync', note: '', reminder: '', fileId: null },
    { id: '3', kind: 'deadline', date: '2026-07-19', time: '12:00', title: 'Submit', note: 'Done', reminder: '1h', fileId: 'file-1' },
  ])
})

test('loadCalendarEntries returns an empty list for malformed storage', () => {
  storage.setItem(CALENDAR_ENTRIES_STORAGE_KEY, '{bad json')
  assert.deepEqual(loadCalendarEntries(), [])
})

test('fromApiEntry trims API time precision and maps file_id', () => {
  assert.deepEqual(
    fromApiEntry({
      id: 'entry-1',
      kind: 'deadline',
      date: '2026-07-18',
      time: '14:15:30',
      title: 'Review',
      note: 'Notes',
      reminder: '15m',
      file_id: 'file-1',
    }),
    {
      id: 'entry-1',
      kind: 'deadline',
      date: '2026-07-18',
      time: '14:15',
      title: 'Review',
      note: 'Notes',
      reminder: '15m',
      fileId: 'file-1',
    },
  )
})

test('entryKey treats file_id and fileId as equivalent identity fields', () => {
  const base = { kind: 'event', date: '2026-07-18', time: '08:00:00', title: 'Daily', note: '', reminder: '' }
  assert.equal(entryKey({ ...base, file_id: 'file-1' }), entryKey({ ...base, fileId: 'file-1' }))
})

test('isCalendarKind excludes all while accepting supported file kinds', () => {
  assert.equal(isCalendarKind('all'), false)
  assert.equal(isCalendarKind('pdf'), true)
  assert.equal(isCalendarKind('unknown'), false)
})

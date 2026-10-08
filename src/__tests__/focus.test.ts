import { describe, expect, it } from 'vitest'
import {
  MAX_FOCUS_TASKS,
  addFocusTask,
  defaultFocusState,
  focusRemainingSeconds,
  formatTimer,
  removeFocusTask,
  renameFocusTask,
  sanitizeFocusState,
  toggleFocusTask,
} from '../lib/focus'

describe('focus', () => {
  it('adds a trimmed task and ignores blanks', () => {
    const state = defaultFocusState()
    const added = addFocusTask(state, '  Finish chapter 4  ').tasks.at(-1)
    expect(added).toMatchObject({ label: 'Finish chapter 4', done: false })
    expect(added?.id).toMatch(/^focus-/)
    expect(addFocusTask(state, '   ')).toBe(state)
  })

  it('caps the number of tasks', () => {
    let state = defaultFocusState()
    for (let i = 0; i < 30; i += 1) state = addFocusTask(state, `Task ${i}`)
    expect(state.tasks).toHaveLength(MAX_FOCUS_TASKS)
  })

  it('removes, toggles and renames tasks by position', () => {
    const state = defaultFocusState()
    expect(removeFocusTask(state, 0).tasks).toHaveLength(state.tasks.length - 1)
    expect(removeFocusTask(state, 99)).toBe(state)
    expect(toggleFocusTask(state, 1).tasks[1].done).toBe(true)
    expect(renameFocusTask(state, 2, 'Walk').tasks[2].label).toBe('Walk')
  })

  it('computes the time left, including while running', () => {
    const base = { ...defaultFocusState(), durationMinutes: 25, elapsedSeconds: 60 }
    expect(focusRemainingSeconds(base)).toBe(24 * 60)
    const running = { ...base, running: true, startedAt: 1_000_000 }
    expect(focusRemainingSeconds(running, 1_000_000 + 30_000)).toBe(24 * 60 - 30)
    expect(focusRemainingSeconds({ ...base, elapsedSeconds: 99_999 })).toBe(0)
  })

  it('formats the timer', () => {
    expect(formatTimer(25 * 60)).toBe('25:00')
    expect(formatTimer(65)).toBe('01:05')
    expect(formatTimer(-3)).toBe('00:00')
  })

  it('reads older saved state that has no session name', () => {
    const state = sanitizeFocusState({
      title: 'Mine',
      tasks: [{ label: 'One', done: true }, { nope: 1 }],
      durationMinutes: 45,
    })
    expect(state.title).toBe('Mine')
    expect(state.session).toBe('Reading')
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({ label: 'One', done: true })
    expect(state.tasks[0].id).toBeTruthy()
    expect(state.durationMinutes).toBe(45)
    expect(sanitizeFocusState('junk')).toEqual(defaultFocusState())
  })
})

describe('focus step ids', () => {
  it('gives the starter steps the same ids on every device', () => {
    const fromOldSave = sanitizeFocusState({
      tasks: [
        { label: 'Read for 30 minutes', done: true },
        { label: 'My own step', done: false },
      ],
    })
    expect(fromOldSave.tasks[0].id).toBe('starter-read')
    expect(fromOldSave.tasks[1].id).toMatch(/^legacy-/)
    expect(defaultFocusState().tasks.map((task) => task.id)).toEqual([
      'starter-read',
      'starter-ideas',
      'starter-reflect',
      'starter-connect',
    ])
  })

  it('keeps ids unique and stamps edits', () => {
    const state = sanitizeFocusState({
      tasks: [
        { id: 'a', label: 'One', done: false },
        { id: 'a', label: 'Two', done: false },
      ],
    })
    expect(new Set(state.tasks.map((task) => task.id)).size).toBe(2)
    expect(toggleFocusTask(state, 0).tasks[0].updated).toBeTruthy()
    expect(renameFocusTask(state, 1, 'Renamed').tasks[1].updated).toBeTruthy()
  })
})

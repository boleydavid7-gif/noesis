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
    expect(addFocusTask(state, '  Finish chapter 4  ').tasks.at(-1)).toEqual({ label: 'Finish chapter 4', done: false })
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
    expect(state.tasks).toEqual([{ label: 'One', done: true }])
    expect(state.durationMinutes).toBe(45)
    expect(sanitizeFocusState('junk')).toEqual(defaultFocusState())
  })
})

import { useSyncExternalStore } from 'react'

let cmdHeld = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Meta' && !cmdHeld) {
    cmdHeld = true
    emit()
  }
}

function handleKeyUp(e: KeyboardEvent) {
  if (e.key === 'Meta' && cmdHeld) {
    cmdHeld = false
    emit()
  }
}

function handleBlur() {
  if (cmdHeld) {
    cmdHeld = false
    emit()
  }
}

window.addEventListener('keydown', handleKeyDown, true)
window.addEventListener('keyup', handleKeyUp)
window.addEventListener('blur', handleBlur)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return cmdHeld
}

export function useCmdHeld() {
  return useSyncExternalStore(subscribe, getSnapshot)
}

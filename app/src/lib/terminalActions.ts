import type { MobileKeyboardRow } from '../types'

export interface TerminalAction {
  id: string
  label: string
  sequence: string
  category: 'modifier' | 'special' | 'ctrl' | 'nav' | 'symbol' | 'function'
  isModifier?: boolean
}

// Central registry of all terminal actions
const actionsArray: TerminalAction[] = [
  // Modifiers (sticky) — sequences are empty, handled specially
  {
    id: 'ctrl',
    label: 'Ctrl',
    sequence: '',
    category: 'modifier',
    isModifier: true,
  },
  {
    id: 'alt',
    label: 'Alt',
    sequence: '',
    category: 'modifier',
    isModifier: true,
  },
  {
    id: 'shift',
    label: 'Shift',
    sequence: '',
    category: 'modifier',
    isModifier: true,
  },

  // Special keys
  { id: 'esc', label: 'Esc', sequence: '\x1b', category: 'special' },
  { id: 'tab', label: 'Tab', sequence: '\t', category: 'special' },
  { id: 'shift-tab', label: '⇧Tab', sequence: '\x1b[Z', category: 'special' },
  { id: 'backspace', label: '⌫', sequence: '\x7f', category: 'special' },
  { id: 'ins', label: 'Ins', sequence: '\x1b[2~', category: 'special' },
  { id: 'del', label: 'Del', sequence: '\x1b[3~', category: 'special' },
  { id: 'paste', label: 'Paste', sequence: '', category: 'special' },
  { id: 'enter', label: '↵', sequence: '\r', category: 'special' },

  // Ctrl combos
  ...Array.from({ length: 26 }, (_, i) => {
    const letter = String.fromCharCode(65 + i) // A-Z
    return {
      id: `ctrl-${letter.toLowerCase()}`,
      label: `^${letter}`,
      sequence: String.fromCharCode(i + 1),
      category: 'ctrl' as const,
    }
  }),
  // Extra ctrl combos
  {
    id: 'ctrl-underscore',
    label: '^_',
    sequence: '\x1f',
    category: 'ctrl',
  },
  {
    id: 'ctrl-x-ctrl-x',
    label: '^X^X',
    sequence: '\x18\x18',
    category: 'ctrl',
  },

  // Alt combos
  {
    id: 'alt-r',
    label: 'Alt-r',
    sequence: '\x1br',
    category: 'ctrl',
  },

  // Navigation
  { id: 'up', label: '↑', sequence: '\x1b[A', category: 'nav' },
  { id: 'down', label: '↓', sequence: '\x1b[B', category: 'nav' },
  { id: 'right', label: '→', sequence: '\x1b[C', category: 'nav' },
  { id: 'left', label: '←', sequence: '\x1b[D', category: 'nav' },
  { id: 'home', label: 'Home', sequence: '\x1b[H', category: 'nav' },
  { id: 'end', label: 'End', sequence: '\x1b[F', category: 'nav' },
  { id: 'pgup', label: 'PgUp', sequence: '\x1b[5~', category: 'nav' },
  { id: 'pgdn', label: 'PgDn', sequence: '\x1b[6~', category: 'nav' },

  // Symbols
  ...(
    [
      ['/', '/'],
      ['|', '|'],
      ['~', '~'],
      ['-', '-'],
      ['=', '='],
      [':', ':'],
      [';', ';'],
      ['!', '!'],
      ['*', '*'],
      ['$', '$'],
      ['%', '%'],
      ['^', '^'],
      ['<', '<'],
      ['>', '>'],
      ['(', '('],
      [')', ')'],
      ['{', '{'],
      ['}', '}'],
      ['[', '['],
      [']', ']'],
      ['.', '.'],
      ['\\', '\\'],
      ['_', '_'],
      ['&', '&'],
      ['+', '+'],
      ['@', '@'],
      ['#', '#'],
      ["'", "'"],
      ['"', '"'],
      ['?', '?'],
    ] as const
  ).map(([label, ch]) => ({
    id: `sym-${label === '\\' ? 'backslash' : label === "'" ? 'quote' : label === '"' ? 'dquote' : label}`,
    label,
    sequence: ch,
    category: 'symbol' as const,
  })),

  // Function keys
  { id: 'f1', label: 'F1', sequence: '\x1bOP', category: 'function' },
  { id: 'f2', label: 'F2', sequence: '\x1bOQ', category: 'function' },
  { id: 'f3', label: 'F3', sequence: '\x1bOR', category: 'function' },
  { id: 'f4', label: 'F4', sequence: '\x1bOS', category: 'function' },
  { id: 'f5', label: 'F5', sequence: '\x1b[15~', category: 'function' },
  { id: 'f6', label: 'F6', sequence: '\x1b[17~', category: 'function' },
  { id: 'f7', label: 'F7', sequence: '\x1b[18~', category: 'function' },
  { id: 'f8', label: 'F8', sequence: '\x1b[19~', category: 'function' },
  { id: 'f9', label: 'F9', sequence: '\x1b[20~', category: 'function' },
  { id: 'f10', label: 'F10', sequence: '\x1b[21~', category: 'function' },
  { id: 'f11', label: 'F11', sequence: '\x1b[23~', category: 'function' },
  { id: 'f12', label: 'F12', sequence: '\x1b[24~', category: 'function' },
  { id: 'f13', label: 'F13', sequence: '\x1b[25~', category: 'function' },
  { id: 'f14', label: 'F14', sequence: '\x1b[26~', category: 'function' },
  { id: 'f15', label: 'F15', sequence: '\x1b[28~', category: 'function' },
  { id: 'f16', label: 'F16', sequence: '\x1b[29~', category: 'function' },
  { id: 'f17', label: 'F17', sequence: '\x1b[31~', category: 'function' },
  { id: 'f18', label: 'F18', sequence: '\x1b[32~', category: 'function' },
  { id: 'f19', label: 'F19', sequence: '\x1b[33~', category: 'function' },
  { id: 'f20', label: 'F20', sequence: '\x1b[34~', category: 'function' },
  { id: 'f21', label: 'F21', sequence: '\x1b[42~', category: 'function' },
  { id: 'f22', label: 'F22', sequence: '\x1b[43~', category: 'function' },
  { id: 'f23', label: 'F23', sequence: '\x1b[44~', category: 'function' },
  { id: 'f24', label: 'F24', sequence: '\x1b[45~', category: 'function' },
]

export const ACTIONS: Record<string, TerminalAction> = Object.fromEntries(
  actionsArray.map((a) => [a.id, a]),
)

export const ALL_ACTIONS = actionsArray

export const DEFAULT_KEYBOARD_ROWS: MobileKeyboardRow[] = [
  {
    id: 'row-1',
    actions: [
      'backspace',
      'ins',
      'del',
      'paste',
      'shift-tab',
      'sym-?',
      'sym-/',
      'sym-|',
    ],
  },
  {
    id: 'row-2',
    actions: [
      'esc',
      'tab',
      'ctrl',
      'alt',
      'ctrl-c',
      'ctrl-i',
      'ctrl-s',
      'ctrl-z',
    ],
  },
  {
    id: 'row-3',
    actions: [
      'sym-/',
      'sym-|',
      'sym-~',
      'sym--',
      'home',
      'pgup',
      'pgdn',
      'end',
    ],
  },
  {
    id: 'row-4',
    actions: [
      'sym-=',
      'sym-:',
      'sym-;',
      'sym-!',
      'sym-*',
      'sym-$',
      'sym-%',
      'sym-^',
    ],
  },
  {
    id: 'row-5',
    actions: [
      'sym-<',
      'sym->',
      'sym-(',
      'sym-)',
      'sym-{',
      'sym-}',
      'sym-[',
      'sym-]',
    ],
  },
  {
    id: 'row-6',
    actions: ['paste', 'del', 'ins', 'sym-@', 'f1', 'f2', 'f3', 'f4'],
  },
  {
    id: 'row-7',
    actions: ['f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12'],
  },
  {
    id: 'row-8',
    actions: [
      'ctrl-underscore',
      'ctrl-l',
      'alt-r',
      'ctrl-x-ctrl-x',
      'ctrl-r',
      'ctrl-g',
      'ctrl-n',
      'ctrl-p',
    ],
  },
  {
    id: 'row-9',
    actions: ['left', 'up', 'down', 'right'],
  },
]

export interface Modifiers {
  ctrl: boolean
  alt: boolean
  shift: boolean
}

/** Apply sticky modifiers to a single character */
export function applyModifier(char: string, modifiers: Modifiers): string {
  let result = char
  if (modifiers.shift) {
    result = result.toUpperCase()
  }
  if (modifiers.ctrl) {
    // Ctrl+letter → control code (char code 1-26)
    const upper = result.toUpperCase()
    const code = upper.charCodeAt(0)
    if (code >= 65 && code <= 90) {
      result = String.fromCharCode(code - 64)
    }
  }
  if (modifiers.alt) {
    result = `\x1b${result}`
  }
  return result
}

/** Apply sticky modifiers to an action's sequence */
export function applyModifierToAction(
  sequence: string,
  modifiers: Modifiers,
): string {
  if (!modifiers.ctrl && !modifiers.alt && !modifiers.shift) return sequence

  // For single printable characters, apply modifiers character-by-character
  if (sequence.length === 1 && sequence.charCodeAt(0) >= 32) {
    return applyModifier(sequence, modifiers)
  }

  // For escape sequences, prepend alt if needed
  if (modifiers.alt && !sequence.startsWith('\x1b')) {
    return `\x1b${sequence}`
  }

  return sequence
}

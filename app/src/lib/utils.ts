import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const sessionStatusColor: Record<string, string> = {
  started: 'text-[#D97757]',
  active: 'text-[#D97757]',
  done: 'text-gray-500',
  ended: 'text-gray-500',
  permission_needed: 'text-[#D97757]',
  idle: 'text-gray-400',
}

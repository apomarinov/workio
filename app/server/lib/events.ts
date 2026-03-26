import { EventEmitter } from 'node:events'
import type { ServerEventMap } from '@server/types/events'

class TypedEventEmitter extends EventEmitter {
  emit<K extends keyof ServerEventMap>(
    event: K,
    ...args: ServerEventMap[K]
  ): boolean {
    return super.emit(event, ...args)
  }

  on<K extends keyof ServerEventMap>(
    event: K,
    listener: (...args: ServerEventMap[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void)
  }
}

const serverEvents = new TypedEventEmitter()
export default serverEvents

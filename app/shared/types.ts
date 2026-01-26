export interface ActiveProcess {
  pid: number
  name: string
  command: string
  port?: number
  terminalId?: number
  source?: 'direct' | 'zellij'
}

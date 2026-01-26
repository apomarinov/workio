export interface ActiveProcess {
  pid: number
  name: string
  command: string
  terminalId?: number
  source?: 'direct' | 'zellij'
}

import { type PoolExecSSHOptions, poolExecSSHCommand } from './pool'

export type ExecSSHOptions = PoolExecSSHOptions

export function execSSHCommand(
  sshHost: string,
  command: string,
  options?: string | ExecSSHOptions,
): Promise<{ stdout: string; stderr: string }> {
  return poolExecSSHCommand(sshHost, command, options)
}

import { getTerminalById } from '@domains/workspace/db/terminals'

export async function resolveGitTerminal(terminalId: number) {
  const terminal = await getTerminalById(terminalId)
  if (!terminal) {
    throw new Error('Terminal not found')
  }
  if (!terminal.git_repo) {
    throw new Error('Not a git repository')
  }
  return terminal as typeof terminal & {
    git_repo: NonNullable<(typeof terminal)['git_repo']>
  }
}

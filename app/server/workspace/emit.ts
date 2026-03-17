import { getIO } from '../io'
import { emitNotification } from '../notify'

export async function emitWorkspace(
  terminalId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const io = getIO()

  // Always emit terminal:workspace for client state updates
  io?.emit('terminal:workspace', { terminalId, ...payload })

  // Determine notification type based on payload state
  let notificationType: string | null = null
  if (payload.deleted) {
    notificationType = 'workspace_deleted'
  } else if (
    payload.setup &&
    typeof payload.setup === 'object' &&
    'status' in payload.setup
  ) {
    const setup = payload.setup as { status: string }
    if (setup.status === 'done') {
      notificationType = 'workspace_ready'
    } else if (setup.status === 'failed') {
      notificationType = 'workspace_failed'
    }
  } else if (
    payload.git_repo &&
    typeof payload.git_repo === 'object' &&
    'status' in payload.git_repo
  ) {
    const gitRepo = payload.git_repo as { status: string }
    if (gitRepo.status === 'failed') {
      notificationType = 'workspace_repo_failed'
    }
  }

  // Additionally insert notification for terminal states that need it
  if (notificationType) {
    await emitNotification(
      notificationType,
      'workspace',
      { terminalId, ...payload },
      `${terminalId}:${notificationType}`,
    )
  }
}

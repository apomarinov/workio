import { api as gh } from './trpc'

// --- GitHub ---

export async function requestPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  reviewer: string,
) {
  await gh.github.requestReview.mutate({ owner, repo, prNumber, reviewer })
}

export async function mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
) {
  await gh.github.merge.mutate({ owner, repo, prNumber, method })
}

export async function closePR(owner: string, repo: string, prNumber: number) {
  await gh.github.close.mutate({ owner, repo, prNumber })
}

export async function renamePR(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
) {
  await gh.github.rename.mutate({ owner, repo, prNumber, title })
}

export async function editPR(
  owner: string,
  repo: string,
  prNumber: number,
  title: string,
  body: string,
  draft?: boolean,
) {
  await gh.github.edit.mutate({ owner, repo, prNumber, title, body, draft })
}

export async function rerunFailedCheck(
  owner: string,
  repo: string,
  prNumber: number,
  checkUrl: string,
) {
  await gh.github.rerunCheck.mutate({ owner, repo, prNumber, checkUrl })
}

export async function rerunAllFailedChecks(
  owner: string,
  repo: string,
  prNumber: number,
  checkUrls: string[],
) {
  return gh.github.rerunAllChecks.mutate({ owner, repo, prNumber, checkUrls })
}

export async function addPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
) {
  await gh.github.comment.mutate({ owner, repo, prNumber, body })
}

export async function replyToReviewComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
) {
  await gh.github.replyToComment.mutate({
    owner,
    repo,
    prNumber,
    commentId,
    body,
  })
}

export async function editComment(
  owner: string,
  repo: string,
  prNumber: number,
  commentId: number,
  body: string,
  type: 'issue_comment' | 'review_comment' | 'review',
) {
  await gh.github.editComment.mutate({
    owner,
    repo,
    prNumber,
    commentId,
    body,
    type,
  })
}

export async function addReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
) {
  await gh.github.addReactionMutation.mutate({
    owner,
    repo,
    subjectId,
    subjectType,
    content,
    prNumber,
  })
}

export async function removeReaction(
  owner: string,
  repo: string,
  subjectId: number,
  subjectType: 'issue_comment' | 'review_comment' | 'review',
  content: string,
  prNumber?: number,
) {
  await gh.github.removeReactionMutation.mutate({
    owner,
    repo,
    subjectId,
    subjectType,
    content,
    prNumber,
  })
}

export async function createPR(
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string,
  body: string,
  draft: boolean,
) {
  return gh.github.create.mutate({
    owner,
    repo,
    head,
    base,
    title,
    body,
    draft,
  })
}

// --- Git branch operations ---

export async function getBranches(terminalId: number) {
  return gh.git.branches.list.query({ terminalId })
}

export async function fetchAll(terminalId: number) {
  await gh.git.branches.fetchAllMutation.mutate({ terminalId })
}

export async function checkoutBranch(
  terminalId: number,
  branch: string,
  _isRemote: boolean,
) {
  await gh.git.branches.checkoutMutation.mutate({ terminalId, branch })
}

export async function pullBranch(terminalId: number, branch: string) {
  await gh.git.branches.pullMutation.mutate({ terminalId, branch })
}

export async function pushBranch(
  terminalId: number,
  branch: string,
  force?: boolean,
) {
  await gh.git.branches.pushMutation.mutate({ terminalId, branch, force })
}

export async function rebaseBranch(terminalId: number, branch: string) {
  return gh.git.branches.rebaseMutation.mutate({ terminalId, branch })
}

export async function createBranch(
  terminalId: number,
  name: string,
  from: string,
) {
  await gh.git.branches.createBranchMutation.mutate({ terminalId, name, from })
}

export async function deleteBranch(
  terminalId: number,
  branch: string,
  deleteRemote?: boolean,
) {
  return gh.git.branches.deleteBranchMutation.mutate({
    terminalId,
    branch,
    deleteRemote,
  })
}

export async function renameBranch(
  terminalId: number,
  branch: string,
  newName: string,
  renameRemote?: boolean,
) {
  return gh.git.branches.renameBranchMutation.mutate({
    terminalId,
    branch,
    newName,
    renameRemote,
  })
}

// --- Git diff operations (imperative callers only) ---

export async function getHeadMessage(terminalId: number) {
  return gh.git.diff.headMessage.query({ terminalId })
}

export async function checkBranchConflicts(
  terminalId: number,
  head: string,
  base: string,
) {
  return gh.git.diff.branchConflicts.query({ terminalId, head, base })
}

export async function getBranchCommits(
  terminalId: number,
  branch: string,
  limit = 20,
  offset = 0,
) {
  return gh.git.diff.branchCommits.query({ terminalId, branch, limit, offset })
}

export async function getChangedFiles(terminalId: number, base?: string) {
  return gh.git.diff.changedFiles.query({ terminalId, base })
}

// --- Webhooks ---

export async function createWebhook(owner: string, repo: string) {
  return gh.github.createWebhook.mutate({ owner, repo })
}

export async function deleteWebhook(owner: string, repo: string) {
  await gh.github.deleteWebhook.mutate({ owner, repo })
}

export async function recreateWebhook(owner: string, repo: string) {
  await gh.github.recreateWebhook.mutate({ owner, repo })
}

export async function testWebhook(owner: string, repo: string) {
  await gh.github.testWebhookMutation.mutate({ owner, repo })
}

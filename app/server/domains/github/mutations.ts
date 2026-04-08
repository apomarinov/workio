import { publicProcedure } from '@server/trpc'
import {
  commentInput,
  createPRInput,
  editCommentInput,
  editInput,
  mergeInput,
  prParamsInput,
  reactionInput,
  renameInput,
  replyToCommentInput,
  requestReviewInput,
  rerunAllChecksInput,
  rerunCheckInput,
  webhookRepoInput,
} from './schema'
import { refreshPRChecks } from './services/checks/polling'
import {
  addPRComment,
  editIssueComment,
  editReview,
  editReviewComment,
  replyToReviewComment,
} from './services/comments'
import {
  closePR,
  createPR,
  editPR,
  mergePR,
  renamePR,
  requestPRReview,
  rerunAllFailedChecks,
  rerunFailedCheck,
} from './services/pr-ops'
import { addReaction, removeReaction } from './services/reactions'
import {
  createRepoWebhook,
  deleteRepoWebhook,
  recreateRepoWebhook,
  testWebhook,
} from './services/webhooks'

export const requestReview = publicProcedure
  .input(requestReviewInput)
  .mutation(async ({ input }) => {
    await requestPRReview(
      input.owner,
      input.repo,
      input.prNumber,
      input.reviewer,
    )
    await refreshPRChecks(true, {
      repo: `${input.owner}/${input.repo}`,
      prNumber: input.prNumber,
      until: (pr) =>
        pr?.reviews?.some(
          (r) => r.author === input.reviewer && r.state === 'PENDING',
        ) ?? false,
    })
  })

export const merge = publicProcedure
  .input(mergeInput)
  .mutation(async ({ input }) => {
    await mergePR(input.owner, input.repo, input.prNumber, input.method)
    await refreshPRChecks(true, {
      repo: `${input.owner}/${input.repo}`,
      prNumber: input.prNumber,
      until: (pr) => !pr || pr.state === 'MERGED',
    })
  })

export const close = publicProcedure
  .input(prParamsInput)
  .mutation(async ({ input }) => {
    await closePR(input.owner, input.repo, input.prNumber)
    await refreshPRChecks(true, {
      repo: `${input.owner}/${input.repo}`,
      prNumber: input.prNumber,
      until: (pr) => !pr || pr.state === 'CLOSED',
    })
  })

export const rename = publicProcedure
  .input(renameInput)
  .mutation(async ({ input }) => {
    await renamePR(input.owner, input.repo, input.prNumber, input.title)
  })

export const edit = publicProcedure
  .input(editInput)
  .mutation(async ({ input }) => {
    await editPR(
      input.owner,
      input.repo,
      input.prNumber,
      input.title,
      input.body,
      input.draft,
    )
  })

export const create = publicProcedure
  .input(createPRInput)
  .mutation(async ({ input }) => {
    const prNumber = await createPR(
      input.owner,
      input.repo,
      input.head,
      input.base,
      input.title,
      input.body,
      input.draft,
    )
    await refreshPRChecks(true, {
      repo: `${input.owner}/${input.repo}`,
      prNumber,
      until: (pr) => !!pr,
    })
    return { prNumber }
  })

export const comment = publicProcedure
  .input(commentInput)
  .mutation(async ({ input }) => {
    await addPRComment(input.owner, input.repo, input.prNumber, input.body)
    await refreshPRChecks(true)
  })

export const replyToComment = publicProcedure
  .input(replyToCommentInput)
  .mutation(async ({ input }) => {
    await replyToReviewComment(
      input.owner,
      input.repo,
      input.prNumber,
      input.commentId,
      input.body,
    )
    await refreshPRChecks(true)
  })

export const editComment = publicProcedure
  .input(editCommentInput)
  .mutation(async ({ input }) => {
    switch (input.type) {
      case 'issue_comment':
        await editIssueComment(
          input.owner,
          input.repo,
          input.commentId,
          input.body,
        )
        break
      case 'review_comment':
        await editReviewComment(
          input.owner,
          input.repo,
          input.commentId,
          input.body,
        )
        break
      case 'review':
        await editReview(
          input.owner,
          input.repo,
          input.prNumber,
          input.commentId,
          input.body,
        )
        break
    }
    await refreshPRChecks(true)
  })

export const addReactionMutation = publicProcedure
  .input(reactionInput)
  .mutation(async ({ input }) => {
    await addReaction(
      input.owner,
      input.repo,
      input.subjectId,
      input.subjectType,
      input.content,
      input.prNumber,
    )
    refreshPRChecks(true)
  })

export const removeReactionMutation = publicProcedure
  .input(reactionInput)
  .mutation(async ({ input }) => {
    await removeReaction(
      input.owner,
      input.repo,
      input.subjectId,
      input.subjectType,
      input.content,
      input.prNumber,
    )
    refreshPRChecks(true)
  })

export const rerunCheck = publicProcedure
  .input(rerunCheckInput)
  .mutation(async ({ input }) => {
    await rerunFailedCheck(
      input.owner,
      input.repo,
      input.checkUrl,
      input.prNumber,
    )
    await refreshPRChecks(true, {
      repo: `${input.owner}/${input.repo}`,
      prNumber: input.prNumber,
      until: (pr) => {
        if (!pr) return false
        return pr.checks.some(
          (c) => c.status === 'QUEUED' || c.status === 'IN_PROGRESS',
        )
      },
    })
  })

export const rerunAllChecks = publicProcedure
  .input(rerunAllChecksInput)
  .mutation(async ({ input }) => {
    const rerunCount = await rerunAllFailedChecks(
      input.owner,
      input.repo,
      input.checkUrls,
      input.prNumber,
    )
    await refreshPRChecks(true, {
      repo: `${input.owner}/${input.repo}`,
      prNumber: input.prNumber,
      until: (pr) => {
        if (!pr) return false
        return pr.checks.some(
          (c) => c.status === 'QUEUED' || c.status === 'IN_PROGRESS',
        )
      },
    })
    return { rerunCount }
  })

export const createWebhook = publicProcedure
  .input(webhookRepoInput)
  .mutation(async ({ input }) => {
    const webhookId = await createRepoWebhook(`${input.owner}/${input.repo}`)
    return { webhookId }
  })

export const deleteWebhook = publicProcedure
  .input(webhookRepoInput)
  .mutation(async ({ input }) => {
    await deleteRepoWebhook(`${input.owner}/${input.repo}`)
  })

export const recreateWebhook = publicProcedure
  .input(webhookRepoInput)
  .mutation(async ({ input }) => {
    await recreateRepoWebhook(`${input.owner}/${input.repo}`)
  })

export const testWebhookMutation = publicProcedure
  .input(webhookRepoInput)
  .mutation(async ({ input }) => {
    await testWebhook(`${input.owner}/${input.repo}`)
  })

export const refreshChecks = publicProcedure.mutation(async () => {
  await refreshPRChecks(true)
})

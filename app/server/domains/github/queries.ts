import { execFileAsyncLogged } from '@server/lib/exec'
import { log } from '@server/logger'
import { publicProcedure } from '@server/trpc'
import {
  closedPRsInput,
  conductorInput,
  involvedPRsInput,
  prCommentsInput,
  reposInput,
} from './schema'
import {
  fetchAllClosedPRs,
  fetchInvolvedPRs,
  fetchPRComments,
} from './services/checks/fetcher'
import { getGhUsername } from './services/checks/state'

export const repos = publicProcedure
  .input(reposInput)
  .query(async ({ input }) => {
    const query = input.q?.trim().toLowerCase() || ''
    try {
      const { stdout } = await execFileAsyncLogged(
        'gh',
        [
          'api',
          '--method',
          'GET',
          '/user/repos',
          '-f',
          'affiliation=owner,collaborator,organization_member',
          '-f',
          'sort=pushed',
          '-f',
          'direction=desc',
          '-f',
          `per_page=${query ? 100 : 15}`,
          '--jq',
          '.[].full_name',
        ],
        { timeout: 15000, category: 'github', errorOnly: true },
      )

      let repos = stdout.trim().split('\n').filter(Boolean)
      if (query) {
        repos = repos.filter((r) => r.toLowerCase().includes(query))
      }
      return { repos }
    } catch (err) {
      log.error({ err }, '[github] Failed to fetch repos')
      return { repos: [] as string[] }
    }
  })

export const conductor = publicProcedure
  .input(conductorInput)
  .query(async ({ input }) => {
    const repo = input.repo.trim()
    if (!repo.includes('/')) {
      return { hasConductor: false }
    }
    try {
      await execFileAsyncLogged(
        'gh',
        ['api', `repos/${repo}/contents/conductor.json`, '--jq', '.name'],
        { timeout: 10000, category: 'github', errorOnly: true },
      )
      return { hasConductor: true }
    } catch (err) {
      log.error({ err }, '[github] Failed to check conductor.json')
      return { hasConductor: false }
    }
  })

export const closedPRs = publicProcedure
  .input(closedPRsInput)
  .query(async ({ input }) => {
    return { prs: await fetchAllClosedPRs(input.repos, input.limit) }
  })

export const involvedPRs = publicProcedure
  .input(involvedPRsInput)
  .query(async ({ input }) => {
    return { prs: await fetchInvolvedPRs(input.repos, input.limit) }
  })

export const prComments = publicProcedure
  .input(prCommentsInput)
  .query(async ({ input }) => {
    return fetchPRComments(
      input.owner,
      input.repo,
      input.prNumber,
      input.limit,
      input.offset,
      input.excludeAuthors,
    )
  })

export const username = publicProcedure.query(() => {
  return { username: getGhUsername() }
})

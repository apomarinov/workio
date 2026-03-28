import {
  DEFAULT_GH_QUERY_LIMITS,
  type GHQueryLimits,
} from '@domains/settings/schema'
import { Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useSettingsView } from '../SettingsViewContext'

const LIMIT_LABELS: Record<keyof GHQueryLimits, string> = {
  checks: 'CI checks',
  reviews: 'Reviews',
  comments: 'Comments',
  review_threads: 'Review threads',
  thread_comments: 'Thread comments',
  review_requests: 'Review requests',
  reactors: 'Reactors',
}

export function QueryLimitsSetting() {
  const { getFormValue, setFormValue } = useSettingsView()
  const limits =
    (getFormValue('gh_query_limits') as GHQueryLimits | undefined) ??
    DEFAULT_GH_QUERY_LIMITS

  const updateLimit = (key: keyof GHQueryLimits, value: string) => {
    const num = Number.parseInt(value, 10)
    if (!Number.isNaN(num) && num >= 1) {
      setFormValue('gh_query_limits', { ...limits, [key]: num })
    }
  }

  return (
    <div className="space-y-3 w-full">
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-[#1a1a1a] p-2.5 rounded-md">
        <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <div>
          GitHub GraphQL API allows 5,000 points/hour. Higher limits give more
          complete data but consume rate limit faster.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(LIMIT_LABELS) as (keyof GHQueryLimits)[]).map((key) => (
          <div key={key} className="space-y-1">
            <label
              htmlFor={`limit-${key}`}
              className="text-xs text-muted-foreground"
            >
              {LIMIT_LABELS[key]}
            </label>
            <Input
              id={`limit-${key}`}
              type="number"
              min={1}
              max={100}
              value={limits[key]}
              onChange={(e) => updateLimit(key, e.target.value)}
              className="h-8 text-sm !bg-[#1a1a1a]"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

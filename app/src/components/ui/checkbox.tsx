import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { CheckCheck, Minus } from 'lucide-react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-zinc-600 bg-zinc-800 shadow-xs outline-none transition-shadow data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white data-[state=indeterminate]:border-blue-500 data-[state=indeterminate]:bg-blue-600 data-[state=indeterminate]:text-white focus-visible:ring-[3px] focus-visible:ring-blue-500/30 focus-visible:border-blue-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer hover:border-2 hover:border-blue-500',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3.5 stroke-3" />
        ) : (
          <CheckCheck className="size-3.5 stroke-3" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }

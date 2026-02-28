import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { Toaster as Sonner, toast } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="top-right"
      className="toaster group"
      style={{ top: 'env(safe-area-inset-top, 0px)' }}
      icons={{
        success: <CircleCheck className="w-4 h-4 text-emerald-400" />,
        error: <CircleAlert className="w-4 h-4 text-red-400" />,
        info: <Info className="w-4 h-4 text-blue-400" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-zinc-900 group-[.toaster]:text-zinc-50 group-[.toaster]:border-zinc-800 group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-zinc-400',
          actionButton:
            'group-[.toast]:bg-zinc-50 group-[.toast]:text-zinc-900',
          cancelButton:
            'group-[.toast]:bg-zinc-800 group-[.toast]:text-zinc-400',
          success:
            'group-[.toaster]:!bg-emerald-950 group-[.toaster]:!border-emerald-900 group-[.toaster]:!text-emerald-50',
          error:
            'group-[.toaster]:!bg-red-950 group-[.toaster]:!border-red-900 group-[.toaster]:!text-red-50',
          info: 'group-[.toaster]:!bg-blue-950 group-[.toaster]:!border-blue-900 group-[.toaster]:!text-blue-50',
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }

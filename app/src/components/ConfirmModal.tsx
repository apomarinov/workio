import { Loader2 } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from '@/components/ui/sonner'

interface SecondaryAction {
  label: string
  onAction: () => void | Promise<void>
}

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string | ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  loading?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  secondaryAction?: SecondaryAction
  children?: React.ReactNode
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading: externalLoading = false,
  onConfirm,
  onCancel,
  secondaryAction,
  children,
}: ConfirmModalProps) {
  const confirmedRef = useRef(false)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)
  const [internalLoading, setInternalLoading] = useState(false)
  const [secondaryLoading, setSecondaryLoading] = useState(false)
  const loading = externalLoading || internalLoading || secondaryLoading

  useEffect(() => {
    if (open) {
      // Focus after AlertDialog animation completes
      const timer = setTimeout(() => confirmButtonRef.current?.focus(), 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault()
    confirmedRef.current = true
    const result = onConfirm()
    if (result instanceof Promise) {
      setInternalLoading(true)
      try {
        await result
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setInternalLoading(false)
        confirmedRef.current = false
      }
    }
  }

  const handleSecondary = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (!secondaryAction) return
    confirmedRef.current = true
    const result = secondaryAction.onAction()
    if (result instanceof Promise) {
      setSecondaryLoading(true)
      try {
        await result
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setSecondaryLoading(false)
        confirmedRef.current = false
      }
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && !loading) {
      if (!confirmedRef.current) {
        onCancel()
      }
      confirmedRef.current = false
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>
            {cancelLabel}
          </AlertDialogCancel>
          {secondaryAction && (
            <AlertDialogAction
              onClick={handleSecondary}
              variant="outline"
              disabled={loading}
              autoFocus={false}
            >
              {secondaryLoading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {secondaryAction.label}
            </AlertDialogAction>
          )}
          <AlertDialogAction
            ref={confirmButtonRef}
            onClick={handleConfirm}
            variant={variant === 'danger' ? 'destructive' : 'default'}
            disabled={loading}
          >
            {(internalLoading || externalLoading) && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

import { useState } from 'react'
import { toastError } from '@/lib/toastError'

export function useDialog(onClose: () => void) {
  const [open, setOpen] = useState(true)
  const [loading, setLoading] = useState(false)

  const handleClose = () => {
    setOpen(false)
    setTimeout(onClose, 300)
  }

  const handleOpenChange = (value: boolean) => {
    if (!value && !loading) {
      handleClose()
    }
  }

  const submit = async (fn: () => Promise<void>) => {
    setLoading(true)
    try {
      await fn()
      handleClose()
    } catch (err) {
      toastError(err)
    } finally {
      setLoading(false)
    }
  }

  return { open, loading, handleClose, handleOpenChange, submit }
}

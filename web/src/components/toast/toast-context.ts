import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error'

export interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  dismiss: (id: number) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const toast = useContext(ToastContext)
  if (!toast) {
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return toast
}

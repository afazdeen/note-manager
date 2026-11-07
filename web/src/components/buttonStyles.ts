// Shared button classes, so every button uses the same tokens and focus ring.

const base =
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

export const buttonStyles = {
  primary: `${base} bg-purple-600 px-3 py-2 text-white hover:bg-purple-700 disabled:hover:bg-purple-600`,
  secondary: `${base} border border-border bg-bg px-3 py-1.5 text-ink hover:bg-purple-50`,
  danger: `${base} border border-red-600 bg-bg px-3 py-1.5 text-red-700 hover:bg-red-50`,
  ghost: `${base} px-2 py-1.5 text-purple-700 hover:bg-purple-50`,
} as const

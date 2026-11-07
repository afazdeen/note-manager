export function App() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <a
        href="#main"
        className="sr-only rounded-md bg-purple-600 px-3 py-2 text-white focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header>
        <div className="mx-auto flex max-w-6xl items-center px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Team Notes</h1>
        </div>
        <div aria-hidden="true" className="h-1 bg-gradient-brand" />
      </header>
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6" />
    </div>
  )
}

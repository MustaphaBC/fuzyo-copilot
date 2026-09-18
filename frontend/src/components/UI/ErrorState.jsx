export default function ErrorState({
  title = 'Something went wrong',
  description = '',
  onRetry = null,
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-red-900/50 bg-red-950/20 px-6 py-10 text-center">
      <h2 className="text-lg font-semibold text-red-200">{title}</h2>
      {description ? (
        <p className="mt-2 max-w-md text-sm text-red-200/80">{description}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg border border-red-800/60 px-3 py-1.5 text-sm text-red-100 hover:bg-red-950/40"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}

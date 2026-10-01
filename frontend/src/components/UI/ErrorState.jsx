export default function ErrorState({
  title = 'Something went wrong',
  description = '',
  onRetry = null,
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center dark:border-red-900/50 dark:bg-red-950/20"
    >
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-200">{title}</h2>
      {description ? (
        <p className="mt-2 max-w-md text-sm text-red-600 dark:text-red-200/80">{description}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100 dark:border-red-800/60 dark:text-red-100 dark:hover:bg-red-950/40"
        >
          Try again
        </button>
      ) : null}
    </div>
  )
}

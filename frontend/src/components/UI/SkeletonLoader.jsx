export default function SkeletonLoader({ className = '', rows = 3 }) {
  return (
    <div className={`animate-pulse space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-3 rounded bg-[var(--panel-elevated)]"
          style={{ width: `${88 - index * 12}%` }}
        />
      ))}
    </div>
  )
}

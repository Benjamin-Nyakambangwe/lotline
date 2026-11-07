import { cn } from "@/lib/utils";

/** Lotline wordmark: a rising price line that settles on a dot (your line on the lot). */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-tight",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6">
        <rect width="24" height="24" rx="7" className="fill-primary/15" />
        <path
          d="M5 16.5 9.5 12l3 2.5L18 8"
          className="stroke-primary"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="8" r="2" className="fill-primary" />
      </svg>
      <span>Lotline</span>
    </span>
  );
}

import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Wordmark className="text-lg" />
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0">
        <div className="mesh w-full max-w-md overflow-hidden rounded-2xl border bg-card p-6 shadow-xl shadow-black/5 sm:p-8">
          {children}
        </div>
      </main>
      <footer className="px-4 py-6 text-center text-xs text-muted-foreground">
        Lotline is an independent tool. Not affiliated with ABC Auctions.
      </footer>
    </div>
  );
}

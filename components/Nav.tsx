import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function Nav() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link
            href="/run"
            className="text-lg font-bold tracking-tight text-zinc-800 dark:text-zinc-100"
          >
            Maestro
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/run"
              className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Run
            </Link>
            <Link
              href="/history"
              className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              History
            </Link>
            <Link
              href="/chat"
              className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Chat
            </Link>
            <Link
              href="/workspace"
              className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Workspace
            </Link>
          </div>
        </div>
        <ThemeToggle />
      </div>
    </nav>
  );
}

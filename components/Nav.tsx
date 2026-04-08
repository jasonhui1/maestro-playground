import Link from 'next/link';

export default function Nav() {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-zinc-200 bg-white/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link 
            href="/run" 
            className="text-lg font-bold tracking-tight text-zinc-800"
          >
            Maestro
          </Link>
          <div className="flex items-center gap-6">
            <Link 
              href="/run" 
              className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-800"
            >
              Run
            </Link>
            <Link 
              href="/history" 
              className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-800"
            >
              History
            </Link>
            <Link 
              href="/workspace" 
              className="text-sm font-medium text-zinc-600 transition-colors hover:text-zinc-800"
            >
              Workspace
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

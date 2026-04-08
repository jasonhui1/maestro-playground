import Sidebar from '@/components/workspace/Sidebar';
import { Suspense } from 'react';

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      <Suspense fallback={<div className="w-64 border-r border-zinc-200 bg-white p-4">Loading sidebar...</div>}>
        <Sidebar />
      </Suspense>
      <main className="flex-1 overflow-auto bg-white">
        {children}
      </main>
    </div>
  );
}

import { NextRequest, NextResponse } from 'next/server';
import { listVersions, getVersionContent } from '@/lib/fs/versions';

// The defaults file has no slug, so it can't share the [type]/[slug] dynamic
// route below it — this mirrors that route with the slug fixed to ''.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const version = searchParams.get('version');

  try {
    if (version) {
      const content = getVersionContent('defaults', '', parseInt(version));
      if (content === null) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      }
      return NextResponse.json({ content });
    }

    const versions = listVersions('defaults', '');
    return NextResponse.json(versions);
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

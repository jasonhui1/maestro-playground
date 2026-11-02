import { NextRequest, NextResponse } from 'next/server';
import { requestWorkspace } from '@/lib/requestWorkspace';

// The defaults file has no slug, so it can't share the [type]/[slug] dynamic
// route below it — this mirrors that route with the slug fixed to ''.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const version = searchParams.get('version');
  const { versions } = requestWorkspace();

  try {
    if (version) {
      const content = versions.read('defaults', '', parseInt(version));
      if (content === null) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      }
      return NextResponse.json({ content });
    }

    return NextResponse.json(versions.list('defaults', ''));
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

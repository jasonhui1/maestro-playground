import { NextRequest, NextResponse } from 'next/server';
import { listVersions, getVersionContent } from '@/lib/fs/versions';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; slug: string }> }
) {
  const { type, slug } = await params;
  const { searchParams } = new URL(req.url);
  const version = searchParams.get('version');

  try {
    if (version) {
      const content = getVersionContent(type, slug, parseInt(version));
      if (content === null) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      }
      return NextResponse.json({ content });
    }

    const versions = listVersions(type, slug);
    return NextResponse.json(versions);
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { listVersions, getVersionContent } from '@/lib/fs/versions';
import { isValidEntityType, resolveAddressedFile, EntityType } from '@/lib/fs/workspace';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; slug: string }> }
) {
  const { type, slug } = await params;

  if (!isValidEntityType(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  // Variants share their declaring file's version snapshots (#123).
  const { storageSlug } = resolveAddressedFile(type as EntityType, slug);
  const { searchParams } = new URL(req.url);
  const version = searchParams.get('version');

  try {
    if (version) {
      const content = getVersionContent(type, storageSlug, parseInt(version));
      if (content === null) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      }
      return NextResponse.json({ content });
    }

    const versions = listVersions(type, storageSlug);
    return NextResponse.json(versions);
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

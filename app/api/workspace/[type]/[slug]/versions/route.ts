import { NextRequest, NextResponse } from 'next/server';
import { isValidEntityType, address, type EntityType } from '@/lib/fs/workspaceFiles';
import { requestWorkspace } from '@/lib/requestWorkspace';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; slug: string }> }
) {
  const { type, slug } = await params;

  if (!isValidEntityType(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  const { root, versions } = requestWorkspace();
  // Variants share their declaring file's version snapshots (#123).
  const { storageSlug } = address(root, type as EntityType, slug);
  const { searchParams } = new URL(req.url);
  const version = searchParams.get('version');
  // A template is never versioned (ADR-0011).
  if (type === 'template') {
    return version ? NextResponse.json({ error: 'Version not found' }, { status: 404 }) : NextResponse.json([]);
  }

  try {
    if (version) {
      const content = versions.read(type, storageSlug, parseInt(version));
      if (content === null) {
        return NextResponse.json({ error: 'Version not found' }, { status: 404 });
      }
      return NextResponse.json({ content });
    }

    return NextResponse.json(versions.list(type, storageSlug));
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

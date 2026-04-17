import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getWorkspacePath } from './workspace';

interface VersionIndex {
  latestVersion: number;
  versions: {
    version: number;
    timestamp: string;
    hash: string;
  }[];
}

export function getVersionsDir(type: string, slug: string): string {
  return path.join(getWorkspacePath(), '.versions', type, slug);
}

function calculateHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Checks if the current content differs from the latest version and creates a new one if it does.
 * Returns the version number associated with this content.
 */
export function snapshotVersion(type: string, slug: string, content: string): number {
  const versionsDir = getVersionsDir(type, slug);
  const indexPath = path.join(versionsDir, 'index.json');
  
  if (!fs.existsSync(versionsDir)) {
    fs.mkdirSync(versionsDir, { recursive: true });
  }

  let index: VersionIndex = { latestVersion: 0, versions: [] };
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch (e) {
      console.error('Failed to parse version index', e);
    }
  }

  const currentHash = calculateHash(content);
  const latestVersionEntry = index.versions[index.versions.length - 1];

  // If content is same as latest, return latest version number
  if (latestVersionEntry && latestVersionEntry.hash === currentHash) {
    return index.latestVersion;
  }

  // Otherwise, create a new version
  const newVersion = index.latestVersion + 1;
  const timestamp = new Date().toISOString();
  
  const versionFilename = `v${newVersion}.md`;
  fs.writeFileSync(path.join(versionsDir, versionFilename), content);

  index.latestVersion = newVersion;
  index.versions.push({
    version: newVersion,
    timestamp,
    hash: currentHash
  });

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  
  return newVersion;
}

export function getVersionContent(type: string, slug: string, version: number): string | null {
  const versionsDir = getVersionsDir(type, slug);
  const versionPath = path.join(versionsDir, `v${version}.md`);
  
  if (!fs.existsSync(versionPath)) return null;
  return fs.readFileSync(versionPath, 'utf-8');
}

export function listVersions(type: string, slug: string): VersionIndex['versions'] {
  const versionsDir = getVersionsDir(type, slug);
  const indexPath = path.join(versionsDir, 'index.json');
  
  if (!fs.existsSync(indexPath)) return [];
  try {
    const index: VersionIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    return index.versions.reverse(); // Newest first
  } catch (e) {
    return [];
  }
}

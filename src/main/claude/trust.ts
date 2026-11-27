// Best-effort, read-only check of Claude Code's workspace trust. There is no
// documented command for it, so this reads one value of `.claude.json`:
// `projects["<root with forward slashes>"].hasTrustDialogAccepted`. Nothing
// else in that file is used, and the file is never written.
import { promises as fs } from 'node:fs';

export type TrustState = 'trusted' | 'not-trusted' | 'unknown';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trustKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

export async function readTrust(globalConfigFile: string, repoRoot: string): Promise<TrustState> {
  let config: unknown;
  try {
    config = JSON.parse(await fs.readFile(globalConfigFile, { encoding: 'utf8', flag: 'r' }));
  } catch {
    return 'unknown';
  }
  if (!isRecord(config) || !isRecord(config.projects)) return 'unknown';
  const projects = config.projects;
  const key = trustKey(repoRoot);
  const lower = key.toLowerCase();
  const match = Object.hasOwn(projects, key)
    ? key
    : Object.keys(projects).find((k) => trustKey(k).toLowerCase() === lower);
  const entry = match === undefined ? undefined : projects[match];
  if (!isRecord(entry)) return 'unknown';
  const accepted = entry.hasTrustDialogAccepted;
  if (accepted === true) return 'trusted';
  if (accepted === false) return 'not-trusted';
  return 'unknown';
}

// Writes the launcher and the helper bundle to <data>\bin\ on every start (spec section 5,
// "Stable paths"). Sessions keep these fixed paths for their whole life, so an update or a move
// of the app only changes the files' contents. Each file goes through a temp file and a rename,
// so a hook that runs at that moment sees the old or the new file, never half of one.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { DataPaths } from '../data-folder';
import { renderLauncher } from './launcher';

const RENAME_TRIES = 20;
const RENAME_WAIT_MS = 25;

export interface HookFileSource {
  /** The Orchtopus executable (process.execPath). */
  exePath: string;
  /** The built helper, out/main/hook-helper.js. */
  helperBundle: string;
}

function isBusy(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

/** rename with retries: a running hook or a virus scanner can hold the target for a moment. */
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!isBusy(error) || attempt >= RENAME_TRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, RENAME_WAIT_MS));
    }
  }
}

async function readOrNull(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

async function replaceFile(file: string, content: Buffer): Promise<void> {
  const current = await readOrNull(file);
  if (current?.equals(content)) return;
  const temp = `${file}.${String(process.pid)}.tmp`;
  try {
    await writeFile(temp, content);
    await renameWithRetry(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function installHookFiles(paths: DataPaths, source: HookFileSource): Promise<void> {
  const bundle = await readFile(source.helperBundle);
  await mkdir(paths.binDir, { recursive: true });
  // The helper first: a new launcher never points at a missing helper.
  await replaceFile(paths.helper, bundle);
  const launcher = renderLauncher({ exePath: source.exePath, helperPath: paths.helper });
  await replaceFile(paths.launcher, Buffer.from(launcher, 'utf8'));
}

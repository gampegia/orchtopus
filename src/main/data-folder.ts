// The one place that knows where Orchtopus keeps its files (spec section 8).
// Default root: %APPDATA%\Orchtopus. ORCHTOPUS_DATA_DIR overrides it for tests and e2e.
import { join, resolve } from 'node:path';

export const DATA_DIR_ENV = 'ORCHTOPUS_DATA_DIR';

export interface DataPaths {
  root: string;
  stateDb: string;
  apiFile: string;
  tokenFile: string;
  spoolDir: string;
  spoolFile: string;
  damagedDir: string;
  binDir: string;
  launcher: string;
  helper: string;
  sessionsDir: string;
  projectsDir: string;
  electronUserData: string;
}

export interface SessionFiles {
  dir: string;
  settings: string;
  systemPrompt: string;
}

export function resolveDataPaths(input: {
  env: Readonly<Record<string, string | undefined>>;
  appData: string;
}): DataPaths {
  const override = input.env[DATA_DIR_ENV];
  const root = override ? resolve(override) : join(input.appData, 'Orchtopus');
  const spoolDir = join(root, 'spool');
  const binDir = join(root, 'bin');
  return {
    root,
    stateDb: join(root, 'state.db'),
    apiFile: join(root, 'api.json'),
    tokenFile: join(root, 'api-token'),
    spoolDir,
    spoolFile: join(spoolDir, 'events.jsonl'),
    damagedDir: join(spoolDir, 'damaged'),
    binDir,
    launcher: join(binDir, 'orchtopus-hook.cmd'),
    helper: join(binDir, 'hook-helper.js'),
    sessionsDir: join(root, 'sessions'),
    projectsDir: join(root, 'projects'),
    electronUserData: join(root, 'electron'),
  };
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Ids become folder names; only plain names are allowed so a path can never leave its folder. */
function checkId(kind: string, id: string): string {
  if (!SAFE_ID.test(id) || id.includes('..')) {
    throw new Error(`invalid ${kind} id: ${JSON.stringify(id)}`);
  }
  return id;
}

export function sessionFiles(paths: DataPaths, sessionId: string): SessionFiles {
  const dir = join(paths.sessionsDir, checkId('session', sessionId));
  return {
    dir,
    settings: join(dir, 'settings.json'),
    systemPrompt: join(dir, 'system-prompt.md'),
  };
}

export function projectFile(paths: DataPaths, projectId: string): string {
  return join(paths.projectsDir, checkId('project', projectId), 'project.json');
}

// Projects: inspect a folder (read only), add it, remove it, run the setup check and remember
// the last start values. Add and remove are logged actions (spec section 8): the decision is in
// the event log before project.json is written or deleted, and a repeat with the same action
// id never does the work twice. Nothing here ever writes into the repository.
import { randomUUID } from 'node:crypto';
import { rm, rmdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type {
  AppStatus,
  InspectResult,
  ProjectView,
  SetupItem,
  StreamMessage,
} from '../../shared/api-types';
import { DEFAULT_BRANCH_PREFIX } from '../../shared/task-name';
import { HttpError } from '../api/router';
import { toProjectView } from '../app-context';
import type { ClaudeConfigPaths } from '../claude/claude-home';
import { readTrust } from '../claude/trust';
import { projectFile, type DataPaths } from '../data-folder';
import { inspectRepo, samePath, type RepoInspection } from '../git/repo-info';
import type { ActionRecord, ActionRunner } from '../store/actions';
import type { Store } from '../store/event-log';
import { listProjects, listSessions, type ProjectRow } from '../store/projections';
import { detectCheckCommands, suggestCopyList } from './detect';
import {
  PROJECT_SCHEMA_VERSION,
  projectConfigSchema,
  writeProjectConfig,
  type ProjectConfig,
} from './project-config';
import { runSetupCheck } from './setup-check';

export type { InspectResult } from '../../shared/api-types';

export interface AddProjectInput {
  path: string;
  checkCommands: ProjectConfig['checkCommands'];
  copyList: string[];
  branchPrefix: string;
}

export type LastStart = ProjectConfig['lastStart'];

export interface ProjectServiceDeps {
  paths: DataPaths;
  store: Store;
  actions: ActionRunner;
  clock: () => string;
  /** The CLI status the app found (`AppStatus['cli']`). */
  cliStatus: () => AppStatus['cli'];
  claudePaths: ClaudeConfigPaths;
  env: Readonly<Record<string, string | undefined>>;
  /** Sends `project` and `project-removed` stream messages. */
  publish?: (message: StreamMessage) => void;
  /** Writes project.json; replaceable in tests. */
  writeConfig?: (file: string, config: ProjectConfig) => Promise<void>;
  /** Deletes project.json; replaceable in tests. */
  removeConfig?: (file: string) => Promise<void>;
  log?: (message: string) => void;
}

export interface ProjectService {
  /** Detects everything the add dialog shows. Writes nothing. */
  inspect(path: string): Promise<InspectResult>;
  /** Adds a project; idempotent by action id (the request id). */
  add(input: AddProjectInput, actionId?: string): Promise<ProjectView>;
  /** Removes the project config; 409 while the project has sessions. */
  remove(projectId: string): Promise<void>;
  setupCheck(projectId: string): Promise<SetupItem[]>;
  rememberStart(projectId: string, lastStart: LastStart): Promise<void>;
  /** Continues add and remove actions a crash left pending (restart sequence). */
  resumePending(): Promise<void>;
}

const DEFAULT_LAST_START: LastStart = { model: null, effort: null, mode: 'auto' };

interface RemoveParams {
  projectId: string;
}

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? 'project' : s;
}

export function createProjectService(deps: ProjectServiceDeps): ProjectService {
  const { paths, store, actions, clock } = deps;
  const writeConfig = deps.writeConfig ?? writeProjectConfig;
  const removeConfig =
    deps.removeConfig ??
    (async (file: string): Promise<void> => {
      await rm(file, { force: true });
    });
  const publish = (message: StreamMessage): void => deps.publish?.(message);

  // Every change runs one after another, so ids, duplicate checks and action steps never race.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  const findProject = (projectId: string): ProjectRow => {
    const row = listProjects(store.db).find((p) => p.id === projectId);
    if (!row) throw new HttpError(404, 'This project does not exist.');
    return row;
  };

  const configOf = (row: ProjectRow): ProjectConfig => {
    const parsed = projectConfigSchema.safeParse(row.config);
    if (!parsed.success) throw new HttpError(500, 'The project config is damaged.');
    return parsed.data;
  };

  const inspectForAdd = async (path: string): Promise<RepoInspection & { ok: true }> => {
    const repo = await inspectRepo(path);
    if (!repo.ok) throw new HttpError(422, repo.message, 'path');
    return repo;
  };

  const buildConfig = (
    repo: RepoInspection & { ok: true },
    input: AddProjectInput,
  ): ProjectConfig => {
    const taken = new Set(listProjects(store.db).map((p) => p.id));
    // A pending remove still owns its id: a resume deletes that project.json, so a re-add must
    // not write its config there.
    for (const pending of actions.pending()) {
      if (pending.kind === 'project.remove') taken.add((pending.params as RemoveParams).projectId);
    }
    const base = slug(basename(repo.root));
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${String(n)}`;
    return projectConfigSchema.parse({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id,
      name: basename(repo.root),
      path: repo.root,
      defaultBranch: repo.defaultBranch,
      remotes: repo.remotes,
      provider: repo.provider,
      checkCommands: input.checkCommands,
      copyList: input.copyList,
      branchPrefix: input.branchPrefix,
      lastStart: DEFAULT_LAST_START,
    });
  };

  const runAdd = async (
    actionId: string,
    input: AddProjectInput,
    checked: (RepoInspection & { ok: true }) | null,
  ): Promise<ProjectView> => {
    const config = await actions.step(actionId, 'config', async () =>
      buildConfig(checked ?? (await inspectForAdd(input.path)), input),
    );
    // Logged before project.json is written.
    store.append({
      id: `project:${config.id}:added:${actionId}`,
      type: 'project.added',
      at: clock(),
      projectId: config.id,
      payload: { name: config.name, path: config.path, config },
    });
    await actions.step(actionId, 'write-config', async () => {
      await writeConfig(projectFile(paths, config.id), config);
      return true;
    });
    const view = toProjectView({
      id: config.id,
      name: config.name,
      path: config.path,
      config,
      addedAt: '',
    });
    actions.finish(actionId, view);
    publish({ v: 1, kind: 'project', project: view });
    return view;
  };

  const runRemove = async (actionId: string, projectId: string): Promise<void> => {
    store.append({
      id: `project:${projectId}:removed:${actionId}`,
      type: 'project.removed',
      at: clock(),
      projectId,
      payload: {},
    });
    await actions.step(actionId, 'delete-config', async () => {
      const file = projectFile(paths, projectId);
      await removeConfig(file);
      // The project folder goes too when nothing else is in it.
      await rmdir(dirname(file)).catch(() => undefined);
      return true;
    });
    actions.finish(actionId, null);
    publish({ v: 1, kind: 'project-removed', projectId });
  };

  const resume = async (record: ActionRecord): Promise<void> => {
    if (record.kind === 'project.add') {
      await runAdd(record.id, record.params as AddProjectInput, null);
    } else if (record.kind === 'project.remove') {
      await runRemove(record.id, (record.params as RemoveParams).projectId);
    }
  };

  return {
    async inspect(path) {
      const repo = await inspectRepo(path);
      if (!repo.ok) {
        return {
          repo,
          checkCommands: { test: null, lint: null, typecheck: null },
          copyList: [],
          branchPrefix: DEFAULT_BRANCH_PREFIX,
          trust: 'unknown',
          setup: [],
        };
      }
      const [checkCommands, copyList, trust] = await Promise.all([
        detectCheckCommands(repo.root),
        suggestCopyList(repo.root),
        readTrust(deps.claudePaths.globalConfig, repo.root),
      ]);
      const setup = await runSetupCheck({
        root: repo.root,
        checkCommands,
        cli: deps.cliStatus(),
        claudePaths: deps.claudePaths,
        env: deps.env,
      });
      return { repo, checkCommands, copyList, branchPrefix: DEFAULT_BRANCH_PREFIX, trust, setup };
    },

    add(input, actionId = randomUUID()) {
      return serialize(async () => {
        const existing = actions.get(actionId);
        if (existing?.status === 'done') return existing.result as ProjectView;
        if (existing?.status === 'failed') {
          throw new HttpError(409, existing.error ?? 'This request failed before.');
        }
        let checked: (RepoInspection & { ok: true }) | null = null;
        if (!existing) {
          // Validate before anything is logged.
          const repo = await inspectForAdd(input.path);
          checked = repo;
          if (listProjects(store.db).some((p) => samePath(p.path, repo.root))) {
            throw new HttpError(409, 'This repository is already a project.', 'path');
          }
          actions.begin('project.add', input, actionId);
        }
        return runAdd(actionId, input, checked);
      });
    },

    remove(projectId) {
      return serialize(async () => {
        findProject(projectId);
        if (listSessions(store.db).some((s) => s.projectId === projectId)) {
          throw new HttpError(409, 'Remove the sessions of this project first.');
        }
        // A pending add of this project must not come back on a later resume (orphan config,
        // ghost row in the UI).
        for (const pending of actions.pending()) {
          if (pending.kind !== 'project.add') continue;
          const config = pending.steps.find((s) => s.name === 'config')?.result as
            ProjectConfig | undefined;
          if (config?.id === projectId) actions.fail(pending.id, 'The project was removed.');
        }
        const params: RemoveParams = { projectId };
        const record = actions.begin('project.remove', params);
        await runRemove(record.id, projectId);
      });
    },

    async setupCheck(projectId) {
      const config = configOf(findProject(projectId));
      return runSetupCheck({
        root: config.path,
        checkCommands: config.checkCommands,
        cli: deps.cliStatus(),
        claudePaths: deps.claudePaths,
        env: deps.env,
      });
    },

    rememberStart(projectId, lastStart) {
      return serialize(async () => {
        const row = findProject(projectId);
        const config = projectConfigSchema.parse({
          ...configOf(row),
          lastStart,
        });
        store.append({
          id: `project:${projectId}:updated:${randomUUID()}`,
          type: 'project.updated',
          at: clock(),
          projectId,
          payload: { config },
        });
        await writeConfig(projectFile(paths, projectId), config);
        publish({ v: 1, kind: 'project', project: toProjectView({ ...row, config }) });
      });
    },

    resumePending() {
      return serialize(async () => {
        for (const record of actions.pending()) {
          try {
            await resume(record);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            deps.log?.(`Could not continue ${record.kind} ${record.id}: ${message}`);
          }
        }
      });
    },
  };
}

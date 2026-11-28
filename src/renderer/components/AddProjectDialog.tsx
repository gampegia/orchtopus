// Add a project: pick the top folder of a Git repository, check it, adjust what was detected,
// see the setup check and, when Claude Code does not trust the folder yet, the trust step.
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type {
  CheckCommandsView,
  InspectResult,
  ProjectView,
  RepoInspectionView,
} from '../../shared/api-types';
import { ApiRequestError } from '../api/client';
import { apiClient } from '../state/store';
import { SetupChecklist } from './SetupChecklist';
import { TrustStep } from './TrustStep';

/** How often the dialog re-checks trust while Claude Code does not trust the folder. */
const TRUST_RECHECK_MS = 2000;

const COMMANDS: { key: keyof CheckCommandsView; label: string }[] = [
  { key: 'test', label: 'Test' },
  { key: 'lint', label: 'Lint' },
  { key: 'typecheck', label: 'Type check' },
];

const PROVIDER_LABEL = { github: 'GitHub', gitlab: 'GitLab' } as const;

interface Fields {
  checkCommands: Record<keyof CheckCommandsView, string>;
  copyList: string[];
  branchPrefix: string;
}

type Inspected = InspectResult & { repo: Extract<RepoInspectionView, { ok: true }> };

function fieldsFrom(result: InspectResult): Fields {
  return {
    checkCommands: {
      test: result.checkCommands.test ?? '',
      lint: result.checkCommands.lint ?? '',
      typecheck: result.checkCommands.typecheck ?? '',
    },
    copyList: [...result.copyList],
    branchPrefix: result.branchPrefix,
  };
}

function errorText(reason: unknown, fallback: string): string {
  return reason instanceof ApiRequestError ? reason.message : fallback;
}

export function AddProjectDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [path, setPath] = useState('');
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [newEntry, setNewEntry] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept across a failed add that never got an answer, so the retry resumes the same action.
  const requestId = useRef<string | null>(null);
  const checkSeq = useRef(0);

  const inspect = (folder: string): void => {
    const target = folder.trim();
    if (target === '') return;
    const seq = (checkSeq.current += 1);
    setChecking(true);
    setRefusal(null);
    setError(null);
    apiClient()
      .post<InspectResult>('/v1/projects/inspect', { path: target })
      .then((result) => {
        if (seq !== checkSeq.current) return;
        setChecking(false);
        if (!result.repo.ok) {
          setInspected(null);
          setFields(null);
          setRefusal(result.repo.message);
          return;
        }
        setInspected(result as Inspected);
        setFields(fieldsFrom(result));
        requestId.current = null;
      })
      .catch((reason: unknown) => {
        if (seq !== checkSeq.current) return;
        setChecking(false);
        setInspected(null);
        setFields(null);
        setRefusal(errorText(reason, 'Could not check this folder'));
      });
  };

  // While Claude Code does not trust the folder, check again; edited fields stay as they are.
  const root = inspected?.repo.root ?? null;
  const trusted = inspected?.trust === 'trusted';
  useEffect(() => {
    if (root === null || trusted) return;
    let stopped = false;
    const timer = setInterval(() => {
      apiClient()
        .post<InspectResult>('/v1/projects/inspect', { path: root })
        .then((result) => {
          if (stopped || !result.repo.ok) return;
          setInspected((current) =>
            current?.repo.root === root ? { ...(result as Inspected) } : current,
          );
        })
        .catch(() => {
          // The next tick tries again.
        });
    }, TRUST_RECHECK_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [root, trusted]);

  const browse = (): void => {
    window.orchtopus
      .pickFolder()
      .then((picked) => {
        if (picked === null) return;
        setPath(picked);
        inspect(picked);
      })
      .catch(() => {
        setRefusal('Could not open the folder picker');
      });
  };

  const add = (): void => {
    // During a re-check the inspected root may be about to change.
    if (inspected === null || fields === null || adding || checking) return;
    requestId.current ??= crypto.randomUUID();
    setAdding(true);
    setError(null);
    apiClient()
      .post<ProjectView>('/v1/projects', {
        path: inspected.repo.root,
        checkCommands: fields.checkCommands,
        copyList: fields.copyList,
        branchPrefix: fields.branchPrefix,
        requestId: requestId.current,
      })
      .then(() => {
        setAdding(false);
        onClose();
      })
      .catch((reason: unknown) => {
        setAdding(false);
        // An answered request is settled; a change and another try needs a new id.
        if (reason instanceof ApiRequestError) requestId.current = null;
        setError(errorText(reason, 'Could not add the project'));
      });
  };

  const submit = (event: React.SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (inspected !== null) add();
    else inspect(path);
  };

  const update = (change: (current: Fields) => Fields): void => {
    // The server replays the params stored under a request id, so an edit needs a new one.
    requestId.current = null;
    setFields((current) => (current === null ? current : change(current)));
  };

  const addEntry = (): void => {
    const entry = newEntry.trim();
    if (entry === '') return;
    update((current) =>
      current.copyList.includes(entry)
        ? current
        : { ...current, copyList: [...current.copyList, entry] },
    );
    setNewEntry('');
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !adding) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Popup className="dialog wide panel">
          <form className="dialog-form" onSubmit={submit} noValidate>
            <Dialog.Title className="dialog-title">Add a project</Dialog.Title>
            <Dialog.Description className="dialog-text">
              Pick the top folder of a Git repository. Orchtopus writes nothing into it.
            </Dialog.Description>

            <div className="dialog-body">
              <div className="field">
                <label className="field-label" htmlFor="project-folder">
                  Folder
                </label>
                <div className="field-row">
                  <input
                    id="project-folder"
                    className="input mono-input"
                    value={path}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="C:\path\to\repository"
                    title={path === '' ? undefined : path}
                    aria-invalid={refusal !== null}
                    aria-describedby={refusal !== null ? 'project-folder-error' : undefined}
                    onChange={(event) => {
                      // What was found belongs to the old path; check the new one first.
                      setPath(event.target.value);
                      requestId.current = null;
                      checkSeq.current += 1;
                      setChecking(false);
                      setInspected(null);
                      setFields(null);
                      setRefusal(null);
                    }}
                  />
                  <button type="button" className="btn" onClick={browse}>
                    Browse
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={checking || path.trim() === ''}
                    onClick={() => {
                      inspect(path);
                    }}
                  >
                    {checking ? 'Checking' : 'Check'}
                  </button>
                </div>
                {refusal !== null && (
                  <p id="project-folder-error" className="field-error" role="alert">
                    {refusal}
                  </p>
                )}
              </div>

              {inspected !== null && fields !== null && (
                <>
                  <dl className="facts">
                    <div className="fact">
                      <dt>Default branch</dt>
                      <dd className="mono">{inspected.repo.defaultBranch}</dd>
                    </div>
                    <div className="fact">
                      <dt>Provider</dt>
                      <dd>
                        {inspected.repo.provider === null
                          ? 'Not recognised'
                          : PROVIDER_LABEL[inspected.repo.provider]}
                      </dd>
                    </div>
                    <div className="fact">
                      <dt>Remotes</dt>
                      <dd>
                        {inspected.repo.remotes.length === 0 ? (
                          'None'
                        ) : (
                          <ul role="list" className="remote-list">
                            {inspected.repo.remotes.map((remote) => (
                              <li key={remote.name} className="remote">
                                <span>{remote.name}</span>
                                <span className="mono truncate" title={remote.url}>
                                  {remote.url}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {/* Before the fields: without trust no session can start. */}
                  <TrustStepOnce
                    key={inspected.repo.root}
                    root={inspected.repo.root}
                    trust={inspected.trust}
                  />

                  <fieldset className="field-group">
                    <legend className="section-title">Check commands</legend>
                    {COMMANDS.map(({ key, label }) => {
                      const value = fields.checkCommands[key];
                      return (
                        <div className="field inline" key={key}>
                          <label className="field-label" htmlFor={`check-${key}`}>
                            {label}
                          </label>
                          <div className="field-row">
                            <input
                              id={`check-${key}`}
                              className="input mono-input"
                              value={value}
                              spellCheck={false}
                              autoComplete="off"
                              placeholder="No command"
                              title={value === '' ? undefined : value}
                              onChange={(event) => {
                                const next = event.target.value;
                                update((current) => ({
                                  ...current,
                                  checkCommands: { ...current.checkCommands, [key]: next },
                                }));
                              }}
                            />
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Clear ${label.toLowerCase()} command`}
                              disabled={value === ''}
                              onClick={() => {
                                update((current) => ({
                                  ...current,
                                  checkCommands: { ...current.checkCommands, [key]: '' },
                                }));
                              }}
                            >
                              <X className="icon-small" strokeWidth={1.5} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </fieldset>

                  <fieldset className="field-group">
                    <legend className="section-title">Copy into new worktrees</legend>
                    <p className="field-hint">Git-ignored files such as .env</p>
                    {fields.copyList.length > 0 && (
                      <ul role="list" aria-label="Copy list" className="copy-list">
                        {fields.copyList.map((entry) => (
                          <li key={entry} className="copy-entry">
                            <span className="mono truncate" title={entry}>
                              {entry}
                            </span>
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Remove ${entry}`}
                              onClick={() => {
                                update((current) => ({
                                  ...current,
                                  copyList: current.copyList.filter((e) => e !== entry),
                                }));
                              }}
                            >
                              <X className="icon-small" strokeWidth={1.5} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="field-row">
                      <input
                        className="input mono-input"
                        aria-label="File to copy"
                        value={newEntry}
                        spellCheck={false}
                        autoComplete="off"
                        placeholder=".env.local"
                        onChange={(event) => {
                          setNewEntry(event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addEntry();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn"
                        disabled={newEntry.trim() === ''}
                        onClick={addEntry}
                      >
                        Add file
                      </button>
                    </div>
                  </fieldset>

                  <div className="field">
                    <label className="field-label" htmlFor="branch-prefix">
                      Branch prefix
                    </label>
                    <input
                      id="branch-prefix"
                      className="input mono-input short"
                      value={fields.branchPrefix}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(event) => {
                        const next = event.target.value;
                        update((current) => ({ ...current, branchPrefix: next }));
                      }}
                    />
                  </div>

                  <section className="field-group" aria-labelledby="setup-title">
                    <h3 id="setup-title" className="section-title">
                      Setup check
                    </h3>
                    <SetupChecklist items={inspected.setup} />
                  </section>
                </>
              )}
            </div>

            {error !== null && (
              <p className="dialog-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close className="btn ghost" disabled={adding}>
                Cancel
              </Dialog.Close>
              <button
                type="button"
                className="btn primary"
                disabled={inspected === null || adding || checking}
                onClick={add}
              >
                {adding ? 'Adding' : 'Add project'}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The trust step, shown once the folder was found untrusted and kept after Claude Code trusts
 * it, so the user sees the result of their answer. A folder trusted from the start needs none.
 */
function TrustStepOnce({
  root,
  trust,
}: {
  root: string;
  trust: InspectResult['trust'];
}): React.JSX.Element | null {
  const [shown, setShown] = useState(trust !== 'trusted');
  if (!shown && trust !== 'trusted') setShown(true);
  return shown ? <TrustStep path={root} trust={trust} /> : null;
}

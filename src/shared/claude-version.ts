// The Claude Code versions Orchtopus knows about (EV-H10). Shared so the UI can name them.

/** The oldest supported version: the documented floor for `onFailure` on command hooks. */
export const MIN_CLAUDE_VERSION = '2.1.295';
/** The version the M1 spike and M1 ran on. Older supported versions get a hint, not a refusal. */
export const TESTED_CLAUDE_VERSION = '2.1.332';

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** True for a supported version older than the tested one. */
export function isUntestedVersion(version: string | null): version is string {
  return (
    version !== null &&
    compareVersions(version, MIN_CLAUDE_VERSION) >= 0 &&
    compareVersions(version, TESTED_CLAUDE_VERSION) < 0
  );
}

/** The setup-check hint for a supported version older than the tested one, else null. */
export function untestedVersionHint(version: string | null): string | null {
  if (!isUntestedVersion(version)) return null;
  return `Claude Code ${version} is older than the tested version ${TESTED_CLAUDE_VERSION}. It should work, but it has not been tested.`;
}

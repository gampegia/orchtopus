import { describe, expect, it } from 'vitest';
import {
  MIN_CLAUDE_VERSION,
  TESTED_CLAUDE_VERSION,
  compareVersions,
  untestedVersionHint,
} from './claude-version';

describe('claude version (EV-H10)', () => {
  it('pins the minimum and the tested version', () => {
    expect(MIN_CLAUDE_VERSION).toBe('2.1.295');
    expect(TESTED_CLAUDE_VERSION).toBe('2.1.332');
  });

  it('compares versions numerically', () => {
    expect(compareVersions('2.1.332', '2.1.295')).toBeGreaterThan(0);
    expect(compareVersions('2.10.0', '2.9.999')).toBeGreaterThan(0);
    expect(compareVersions('2.1.295', '2.1.295')).toBe(0);
  });

  it('names a supported version below the tested one', () => {
    expect(untestedVersionHint('2.1.310')).toBe(
      'Claude Code 2.1.310 is older than the tested version 2.1.332. It should work, but it has not been tested.',
    );
    expect(untestedVersionHint('2.1.295')).not.toBeNull();
  });

  it('says nothing for the tested version or newer, or an unknown one', () => {
    expect(untestedVersionHint('2.1.332')).toBeNull();
    expect(untestedVersionHint('2.2.0')).toBeNull();
    expect(untestedVersionHint(null)).toBeNull();
  });

  it('leaves a version below the minimum to the too-old message', () => {
    expect(untestedVersionHint('2.1.294')).toBeNull();
  });
});

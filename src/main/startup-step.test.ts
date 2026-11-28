import { describe, expect, it, vi } from 'vitest';
import { tryStartupStep } from './startup-step';

describe('tryStartupStep', () => {
  it('returns the result of a step that succeeds', async () => {
    const warn = vi.fn();
    await expect(tryStartupStep('Spool import', () => Promise.resolve(3), warn)).resolves.toBe(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and returns null when the step rejects, so the app still starts', async () => {
    const warn = vi.fn();
    const step = (): Promise<number> => Promise.reject(new Error('EBUSY: file is locked'));
    await expect(tryStartupStep('Spool import', step, warn)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('Spool import failed: EBUSY: file is locked');
  });

  it('also catches a step that throws synchronously', async () => {
    const warn = vi.fn();
    const step = (): Promise<number> => {
      throw new Error('rename failed');
    };
    await expect(tryStartupStep('Hook file install', step, warn)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith('Hook file install failed: rename failed');
  });
});

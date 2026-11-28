import { describe, expect, it } from 'vitest';
import { folderPathSchema } from './schemas';

describe('folderPathSchema', () => {
  it('accepts local drive paths', () => {
    for (const path of [
      String.raw`C:\repos\acme-app`,
      'C:/repos/acme-app',
      String.raw`d:\acme-web`,
    ]) {
      expect(folderPathSchema.safeParse(path).success, path).toBe(true);
    }
  });

  it('refuses UNC, device, drive-less and relative paths', () => {
    for (const path of [
      String.raw`\\host\share\acme-app`,
      '//host/share/acme-app',
      String.raw`\\?\C:\acme-app`,
      '//./C:/acme-app',
      String.raw`\acme-app`,
      '/acme-app',
      'C:acme-app',
      'acme-app',
      'C:\\acme\0app',
    ]) {
      expect(folderPathSchema.safeParse(path).success, path).toBe(false);
    }
  });
});

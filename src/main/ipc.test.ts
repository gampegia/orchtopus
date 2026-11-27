import { describe, expect, it } from 'vitest';
import { isTrustedSender } from './ipc';

describe('isTrustedSender', () => {
  const allowed = ['app://orchtopus'];

  it('accepts a page on an allowed origin', () => {
    expect(isTrustedSender('app://orchtopus/index.html', allowed)).toBe(true);
    expect(isTrustedSender('http://127.0.0.1:5173/', ['http://127.0.0.1:5173'])).toBe(true);
  });

  it('refuses other origins, look-alikes and missing frames', () => {
    for (const url of [
      'https://evil.test/',
      'app://orchtopus.evil.test/index.html',
      'app://evil/index.html',
      'file:///C:/index.html',
      'about:blank',
      'not a url',
      '',
      undefined,
    ]) {
      expect(isTrustedSender(url, allowed)).toBe(false);
    }
  });
});

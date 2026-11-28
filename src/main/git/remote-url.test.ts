import { describe, expect, it } from 'vitest';
import { redactUrls, stripCredentials } from './remote-url';

describe('stripCredentials', () => {
  it.each([
    [
      'https://x-access-token:FAKE_TOKEN@github.com/acme/acme-app.git',
      'https://github.com/acme/acme-app.git',
    ],
    [
      'https://user@gitlab.com/acme/acme-web.git?private_token=x',
      'https://gitlab.com/acme/acme-web.git',
    ],
    ['http://user:pw@example.test/acme.git', 'http://example.test/acme.git'],
    ['ssh://git:pw@host/acme.git', 'ssh://git@host/acme.git'],
    ['ssh://git@host/acme.git', 'ssh://git@host/acme.git'],
    ['git@github.com:acme/acme-app.git', 'git@github.com:acme/acme-app.git'],
    ['C:\repos\remote.git', 'C:\repos\remote.git'],
    ['https://github.com/acme/acme-app.git', 'https://github.com/acme/acme-app.git'],
  ])('%s -> %s', (input, expected) => {
    expect(stripCredentials(input)).toBe(expected);
  });

  it('drops the user info of an unparsable http URL', () => {
    expect(stripCredentials('https://a:FAKE_TOKEN@[bad/acme.git')).not.toContain('FAKE_TOKEN');
  });
});

describe('redactUrls', () => {
  it('removes credentials from URLs inside free text', () => {
    const text =
      "fatal: unable to access 'https://x-access-token:FAKE_TOKEN@github.com/acme/acme-app.git/': error";
    const out = redactUrls(text);
    expect(out).not.toContain('FAKE_TOKEN');
    expect(out).toContain('https://github.com/acme/acme-app.git/');
  });
});

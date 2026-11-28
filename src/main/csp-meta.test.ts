import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from './security';

const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');

describe('renderer index.html', () => {
  it('carries exactly the content security policy from security.ts', () => {
    const match = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
    expect(match?.[1]).toBe(CONTENT_SECURITY_POLICY);
  });

  it('allows only loopback for connect-src', () => {
    const directive = CONTENT_SECURITY_POLICY.split(';')
      .map((part) => part.trim().split(/\s+/))
      .find((parts) => parts[0] === 'connect-src');
    expect(directive).toEqual(['connect-src', "'self'", 'http://127.0.0.1:*', 'ws://127.0.0.1:*']);
  });

  it('loads no remote resources', () => {
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
  });

  it('is titled with the product name', () => {
    expect(html).toContain('<title>Orchtopus</title>');
  });
});

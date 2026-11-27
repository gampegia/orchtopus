import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from './security';

const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');

describe('renderer index.html', () => {
  it('carries exactly the content security policy from security.ts', () => {
    const match = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
    expect(match?.[1]).toBe(CONTENT_SECURITY_POLICY);
  });

  it('loads no remote resources', () => {
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
  });

  it('is titled with the product name', () => {
    expect(html).toContain('<title>Orchtopus</title>');
  });
});

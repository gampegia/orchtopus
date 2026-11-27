import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { CONTENT_SECURITY_POLICY, denyAllPermissions, hardenWebContents } from './security';

type Listener = (event: { preventDefault: () => void }) => void;

function fakeContents() {
  const listeners = new Map<string, Listener>();
  let openHandler: ((details: { url: string }) => unknown) | undefined;
  const contents = {
    on(name: string, listener: Listener) {
      listeners.set(name, listener);
      return contents;
    },
    setWindowOpenHandler(handler: (details: { url: string }) => unknown) {
      openHandler = handler;
    },
  };
  return { contents: contents as unknown as WebContents, listeners, open: () => openHandler };
}

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe('CONTENT_SECURITY_POLICY', () => {
  const policy = directives(CONTENT_SECURITY_POLICY);

  it('denies everything by default and allows only local scripts and styles', () => {
    expect(policy.get('default-src')).toEqual(["'none'"]);
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('style-src')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'none'"]);
  });

  it('contains no unsafe keyword, wildcard or remote source', () => {
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-|\*|https?:|data:|blob:/);
  });
});

describe('hardenWebContents', () => {
  it.each(['will-navigate', 'will-attach-webview'])('prevents %s', (name) => {
    const fake = fakeContents();
    hardenWebContents(fake.contents);
    const preventDefault = vi.fn();
    fake.listeners.get(name)?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('denies every new window', () => {
    const fake = fakeContents();
    hardenWebContents(fake.contents);
    expect(fake.open()?.({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
  });
});

describe('denyAllPermissions', () => {
  it('denies permission requests and checks', () => {
    let request: ((...args: unknown[]) => void) | undefined;
    let check: (() => boolean) | undefined;
    const session = {
      setPermissionRequestHandler: (handler: typeof request) => {
        request = handler;
      },
      setPermissionCheckHandler: (handler: typeof check) => {
        check = handler;
      },
    } as unknown as Session;
    denyAllPermissions(session);
    const callback = vi.fn();
    request?.({}, 'media', callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect(check?.()).toBe(false);
  });
});

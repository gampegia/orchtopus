import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { APP_ORIGIN } from '../shared/app-origin';
import { BUILT_RENDERER_URL } from './load-renderer';
import { CONTENT_SECURITY_POLICY, denyAllPermissions, hardenWebContents } from './security';

type Listener = (event: { preventDefault: () => void; url?: string }, ...args: unknown[]) => void;

const builtPage = BUILT_RENDERER_URL;
const builtPolicy = { startupUrl: BUILT_RENDERER_URL, allowReloadNavigation: false };
const devPolicy = { startupUrl: 'http://localhost:5173/', allowReloadNavigation: true };

function fakeContents(currentUrl = builtPage) {
  const listeners = new Map<string, Listener>();
  let openHandler: ((details: { url: string }) => unknown) | undefined;
  const contents = {
    on(name: string, listener: Listener) {
      listeners.set(name, listener);
      return contents;
    },
    getURL: () => currentUrl,
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

  it('is exactly the reviewed policy', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
        "font-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; " +
        "base-uri 'none'; form-action 'none'; " +
        "object-src 'none'",
    );
  });

  it('denies everything by default and allows only local scripts and styles', () => {
    expect(policy.get('default-src')).toEqual(["'none'"]);
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('style-src')).toEqual(["'self'"]);
    expect(policy.get('img-src')).toEqual(["'self'"]);
    expect(policy.get('font-src')).toEqual(["'self'"]);
    // The local API only: loopback on any port (the port is chosen at start).
    expect(policy.get('connect-src')).toEqual(["'self'", 'http://127.0.0.1:*', 'ws://127.0.0.1:*']);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'none'"]);
  });

  it('contains no unsafe keyword, wildcard or remote source outside the loopback API', () => {
    const rest = CONTENT_SECURITY_POLICY.replace(' http://127.0.0.1:* ws://127.0.0.1:*', '');
    expect(rest).not.toMatch(/unsafe-|\*|https?:|wss?:|data:|blob:/);
  });
});

describe('hardenWebContents', () => {
  function fire(name: string, url: string, policy = builtPolicy, current = builtPage) {
    const fake = fakeContents(current);
    hardenWebContents(fake.contents, policy, vi.fn());
    const preventDefault = vi.fn();
    const listener = fake.listeners.get(name);
    expect(listener, name).toBeDefined();
    listener?.({ preventDefault, url });
    return preventDefault;
  }

  it('prevents will-attach-webview', () => {
    expect(fire('will-attach-webview', builtPage)).toHaveBeenCalledOnce();
  });

  it('prevents will-navigate to another page', () => {
    expect(fire('will-navigate', `${APP_ORIGIN}/?navigated`)).toHaveBeenCalledOnce();
    expect(fire('will-navigate', 'https://example.com/')).toHaveBeenCalledOnce();
  });

  it('prevents will-navigate to the current page outside the dev server', () => {
    expect(fire('will-navigate', builtPage)).toHaveBeenCalledOnce();
  });

  it('lets the dev server reload the current page', () => {
    const devPage = 'http://localhost:5173/';
    expect(fire('will-navigate', devPage, devPolicy, devPage)).not.toHaveBeenCalled();
    expect(fire('will-navigate', 'https://example.com/', devPolicy, devPage)).toHaveBeenCalled();
  });

  // history.pushState changes getURL() without a navigation; the exception must not follow it.
  it('compares a dev reload against the startup URL, not the current URL', () => {
    const pushed = 'http://localhost:5173/other.html';
    expect(fire('will-navigate', pushed, devPolicy, pushed)).toHaveBeenCalledOnce();
    expect(
      fire('will-navigate', 'http://localhost:5173/', devPolicy, pushed),
    ).not.toHaveBeenCalled();
  });

  it('allows will-redirect to the startup origin only', () => {
    expect(fire('will-redirect', BUILT_RENDERER_URL)).not.toHaveBeenCalled();
    expect(fire('will-redirect', 'https://example.com/')).toHaveBeenCalledOnce();
    expect(fire('will-redirect', 'http://localhost:5173/', devPolicy)).not.toHaveBeenCalled();
    expect(fire('will-redirect', 'http://localhost:5174/', devPolicy)).toHaveBeenCalledOnce();
  });

  it('logs a refused navigation or redirect', () => {
    const fake = fakeContents();
    const log = vi.fn();
    hardenWebContents(fake.contents, builtPolicy, log);
    const url = 'https://example.com/';
    fake.listeners.get('will-navigate')?.({ preventDefault: vi.fn(), url });
    fake.listeners.get('will-redirect')?.({ preventDefault: vi.fn(), url });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('logs only the origin and path of a refused URL', () => {
    const fake = fakeContents();
    const log = vi.fn();
    hardenWebContents(fake.contents, builtPolicy, log);
    const url = 'https://example.com/report-export/a?token=acme-secret#section-two';
    fake.listeners.get('will-navigate')?.({ preventDefault: vi.fn(), url });
    fake.listeners.get('will-redirect')?.({ preventDefault: vi.fn(), url });
    expect(log).toHaveBeenCalledTimes(2);
    for (const [message] of log.mock.calls as [string][]) {
      expect(message).toContain('https://example.com/report-export/a');
      expect(message).not.toMatch(/token|acme-secret|section-two|[?#]/);
    }
  });

  it('logs no content for a URL without a host', () => {
    const fake = fakeContents();
    const log = vi.fn();
    hardenWebContents(fake.contents, builtPolicy, log);
    for (const url of ['data:text/html,acme-secret', 'not a url acme-secret']) {
      fake.listeners.get('will-navigate')?.({ preventDefault: vi.fn(), url });
    }
    expect(log).toHaveBeenCalledTimes(2);
    for (const [message] of log.mock.calls as [string][]) {
      expect(message).not.toContain('acme-secret');
    }
  });

  it('prevents will-frame-navigate in subframes', () => {
    const fake = fakeContents();
    hardenWebContents(fake.contents, builtPolicy, vi.fn());
    const preventDefault = vi.fn();
    fake.listeners.get('will-frame-navigate')?.({ preventDefault, isMainFrame: false } as never);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  // The main frame is guarded by will-navigate; will-frame-navigate also fires for reloads there.
  it('leaves main-frame will-frame-navigate to will-navigate', () => {
    const fake = fakeContents();
    hardenWebContents(fake.contents, builtPolicy, vi.fn());
    const preventDefault = vi.fn();
    fake.listeners.get('will-frame-navigate')?.({ preventDefault, isMainFrame: true } as never);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('cancels Bluetooth device selection instead of picking the first device', () => {
    const fake = fakeContents();
    hardenWebContents(fake.contents, builtPolicy, vi.fn());
    const preventDefault = vi.fn();
    const callback = vi.fn();
    const listener = fake.listeners.get('select-bluetooth-device');
    expect(listener).toBeDefined();
    listener?.({ preventDefault }, [{ deviceId: 'acme-device', deviceName: 'acme' }], callback);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith('');
  });

  it('denies every new window', () => {
    const fake = fakeContents();
    hardenWebContents(fake.contents, builtPolicy, vi.fn());
    expect(fake.open()?.({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
  });
});

describe('denyAllPermissions', () => {
  function fakeSession() {
    const handlers: {
      request?: (...args: unknown[]) => void;
      check?: () => boolean;
      device?: () => boolean;
      displayMedia?: (...args: unknown[]) => void;
    } = {};
    const session = {
      setPermissionRequestHandler: (handler: typeof handlers.request) => {
        handlers.request = handler;
      },
      setPermissionCheckHandler: (handler: typeof handlers.check) => {
        handlers.check = handler;
      },
      setDevicePermissionHandler: (handler: typeof handlers.device) => {
        handlers.device = handler;
      },
      setDisplayMediaRequestHandler: (handler: typeof handlers.displayMedia) => {
        handlers.displayMedia = handler;
      },
    } as unknown as Session;
    return { session, handlers };
  }

  it('denies permission requests and checks', () => {
    const { session, handlers } = fakeSession();
    denyAllPermissions(session);
    const callback = vi.fn();
    handlers.request?.({}, 'media', callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect(handlers.check?.()).toBe(false);
  });

  it('denies device permissions', () => {
    const { session, handlers } = fakeSession();
    denyAllPermissions(session);
    expect(handlers.device).toBeDefined();
    expect(handlers.device?.()).toBe(false);
  });

  it('answers display capture requests with no source', () => {
    const { session, handlers } = fakeSession();
    denyAllPermissions(session);
    const callback = vi.fn();
    expect(handlers.displayMedia).toBeDefined();
    handlers.displayMedia?.({}, callback);
    expect(callback).toHaveBeenCalledWith({});
  });
});

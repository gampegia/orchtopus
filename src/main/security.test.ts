import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { CONTENT_SECURITY_POLICY, denyAllPermissions, hardenWebContents } from './security';

type Listener = (event: { preventDefault: () => void }, ...args: unknown[]) => void;

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

  it('is exactly the reviewed policy', () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; " +
        "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; " +
        "object-src 'none'",
    );
  });

  it('denies everything by default and allows only local scripts and styles', () => {
    expect(policy.get('default-src')).toEqual(["'none'"]);
    expect(policy.get('script-src')).toEqual(["'self'"]);
    expect(policy.get('style-src')).toEqual(["'self'"]);
    expect(policy.get('img-src')).toEqual(["'self'"]);
    expect(policy.get('font-src')).toEqual(["'self'"]);
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
  it.each(['will-navigate', 'will-redirect', 'will-attach-webview'])('prevents %s', (name) => {
    const fake = fakeContents();
    hardenWebContents(fake.contents);
    const preventDefault = vi.fn();
    const listener = fake.listeners.get(name);
    expect(listener, name).toBeDefined();
    listener?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('prevents will-frame-navigate in subframes', () => {
    const fake = fakeContents();
    hardenWebContents(fake.contents);
    const preventDefault = vi.fn();
    fake.listeners.get('will-frame-navigate')?.({ preventDefault, isMainFrame: false } as never);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  // The main frame is guarded by will-navigate; will-frame-navigate also fires for reloads there.
  it('leaves main-frame will-frame-navigate to will-navigate', () => {
    const fake = fakeContents();
    hardenWebContents(fake.contents);
    const preventDefault = vi.fn();
    fake.listeners.get('will-frame-navigate')?.({ preventDefault, isMainFrame: true } as never);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('cancels Bluetooth device selection instead of picking the first device', () => {
    const fake = fakeContents();
    hardenWebContents(fake.contents);
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
    hardenWebContents(fake.contents);
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

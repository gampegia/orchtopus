import { describe, expect, it } from 'vitest';
import { APP_ORIGIN } from '../shared/app-origin';
import { BUILT_RENDERER_URL } from './load-renderer';
import { isAllowedNavigation, isAllowedRedirect, originOf } from './navigation';

describe('originOf', () => {
  it.each([
    ['app://orchtopus/index.html', 'app://orchtopus'],
    ['http://localhost:5173/', 'http://localhost:5173'],
    ['http://LOCALHOST:5173/x?y#z', 'http://localhost:5173'],
  ])('%s has origin %s', (url, origin) => {
    expect(originOf(url)).toBe(origin);
  });

  it.each(['not a url', '', 'about:blank', 'data:text/html,x'])('%j has none', (url) => {
    expect(originOf(url)).toBeNull();
  });
});

describe('isAllowedRedirect', () => {
  const dev = { startupUrl: 'http://localhost:5173/', allowReloadNavigation: true };
  const built = { startupUrl: BUILT_RENDERER_URL, allowReloadNavigation: false };

  it.each([
    [dev, 'http://localhost:5173/index.html'],
    [dev, 'http://localhost:5173/assets/x.js?v=1'],
    [built, 'app://orchtopus/index.html'],
  ])('allows a redirect to the startup origin (%#)', (policy, target) => {
    expect(isAllowedRedirect(target, policy)).toBe(true);
  });

  it.each([
    [dev, 'http://localhost:5174/'],
    [dev, 'http://127.0.0.1:5173/'],
    [dev, 'https://localhost:5173/'],
    [dev, 'https://example.com/'],
    [built, 'app://other/index.html'],
    [built, 'file:///C:/acme-app/index.html'],
    [built, 'not a url'],
  ])('refuses a redirect elsewhere (%#)', (policy, target) => {
    expect(isAllowedRedirect(target, policy)).toBe(false);
  });
});

describe('isAllowedNavigation', () => {
  const devUrl = 'http://localhost:5173/';
  const dev = { startupUrl: devUrl, allowReloadNavigation: true };
  const built = { startupUrl: BUILT_RENDERER_URL, allowReloadNavigation: false };

  // Vite's full reload sets location to the page it is on.
  it('allows a dev server reload of the page the window loaded first', () => {
    expect(isAllowedNavigation(devUrl, dev)).toBe(true);
    expect(isAllowedNavigation(`${devUrl}#top`, dev)).toBe(true);
  });

  it.each([
    ['another page on the dev server', 'http://localhost:5173/other.html'],
    ['the same page with a query', 'http://localhost:5173/?x=1'],
    ['another origin', 'https://example.com/'],
    ['about:blank', 'about:blank'],
    ['an unparseable target', 'not a url'],
  ])('refuses %s in dev', (_label, target) => {
    expect(isAllowedNavigation(target, dev)).toBe(false);
  });

  it('refuses a startup URL that is not on an origin', () => {
    const blank = { startupUrl: 'about:blank', allowReloadNavigation: true };
    expect(isAllowedNavigation('about:blank', blank)).toBe(false);
  });

  it('refuses every navigation, the startup page too, outside dev', () => {
    expect(isAllowedNavigation(BUILT_RENDERER_URL, built)).toBe(false);
    expect(isAllowedNavigation(`${APP_ORIGIN}/?navigated`, built)).toBe(false);
  });
});

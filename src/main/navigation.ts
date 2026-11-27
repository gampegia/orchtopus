/** Where the main window started and whether a reload by navigation is expected there. */
export interface NavigationPolicy {
  /** The URL the main window loaded first (the built page or the dev server page). */
  readonly startupUrl: string;
  /** True for the Vite dev server only: its full reload navigates to the current page. */
  readonly allowReloadNavigation: boolean;
}

/**
 * `scheme://host[:port]` of a URL, or null when it has no host. Built from the parts because
 * Node reports an opaque origin ("null") for custom schemes such as app:.
 */
export function originOf(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.host === '' ? null : `${url.protocol}//${url.host}`;
}

/** The URL without its fragment, or null when it does not parse. */
function documentUrl(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

/** A redirect may only stay on the origin the window started on. */
export function isAllowedRedirect(target: string, policy: NavigationPolicy): boolean {
  const origin = originOf(policy.startupUrl);
  return origin !== null && originOf(target) === origin;
}

/**
 * Navigation is refused, except that the dev server may reload the page the window loaded first
 * (same URL, fragment ignored). The comparison is against the startup URL, not the current URL:
 * `history.pushState` changes the current URL without a navigation, and must not widen the
 * exception. A page that pushes another URL therefore cannot be reloaded by the dev server.
 */
export function isAllowedNavigation(target: string, policy: NavigationPolicy): boolean {
  if (!policy.allowReloadNavigation) return false;
  const page = documentUrl(policy.startupUrl);
  return page !== null && originOf(page) !== null && documentUrl(target) === page;
}

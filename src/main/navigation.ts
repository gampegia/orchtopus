/** Where the main window started and whether a reload by navigation is expected there. */
export interface NavigationPolicy {
  /** `scheme://host[:port]` of the page the main window loaded first. */
  readonly startupOrigin: string;
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
  return originOf(target) === policy.startupOrigin;
}

/**
 * Navigation is refused, except that the dev server may reload the page the window is on
 * (same URL, fragment ignored) when that page is on the startup origin.
 */
export function isAllowedNavigation(
  target: string,
  current: string,
  policy: NavigationPolicy,
): boolean {
  if (!policy.allowReloadNavigation) return false;
  const page = documentUrl(current);
  return page !== null && documentUrl(target) === page && originOf(page) === policy.startupOrigin;
}

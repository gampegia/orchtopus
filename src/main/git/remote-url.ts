// Removes credentials from Git remote URLs before they are stored, logged or
// shown (Review Focus 4).

const HTTP_URL = /^https?:\/\//i;
const SSH_URL = /^(?:ssh|git\+ssh|ssh\+git):\/\//i;

/**
 * http(s) URLs lose user, password and query; ssh:// URLs lose the password
 * only; the scp form (`git@host:path`) and local paths stay as they are.
 */
export function stripCredentials(url: string): string {
  if (HTTP_URL.test(url)) {
    try {
      const parsed = new URL(url);
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      return parsed.toString();
    } catch {
      return dropUserInfo(url).replace(/\?.*$/s, '');
    }
  }
  if (SSH_URL.test(url)) {
    try {
      const parsed = new URL(url);
      parsed.password = '';
      return parsed.toString();
    } catch {
      return url.replace(/^([a-z+]+:\/\/[^:@/]*):[^@/]*@/i, '$1@');
    }
  }
  return url;
}

function dropUserInfo(url: string): string {
  return url.replace(/^([a-z+]+:\/\/)[^@/]*@/i, '$1');
}

/** Strips credentials from every URL that appears inside free text (git stderr). */
export function redactUrls(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, (match) => stripCredentials(match));
}

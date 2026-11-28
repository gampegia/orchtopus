// One xterm.js terminal in a host element, as every terminal of the app uses it: the theme and
// font from the design tokens, fit, unicode11 and webgl (DOM renderer when webgl fails), a
// re-theme on a colour mode change and a fit on every host resize.
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import { isTerminalEscapeKey } from './terminal-focus';
import { buildXtermTheme, xtermFont } from './xterm-theme';

/** The host element keeps its xterm, so e2e tests can read the buffer. */
export type TerminalHost = HTMLDivElement & { orchtopusTerminal?: Terminal };

export interface MountedXterm {
  term: Terminal;
  dispose: () => void;
}

const readToken = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name);

export interface MountOptions {
  /** Called on F6, which xterm then does not send: the way out, since Tab goes to the PTY. */
  onEscape?: () => void;
}

export function mountXterm(host: TerminalHost, options: MountOptions = {}): MountedXterm {
  const term = new Terminal({
    ...xtermFont(readToken),
    theme: buildXtermTheme(readToken),
    allowProposedApi: true,
    smoothScrollDuration: 0,
    cursorBlink: false,
    // PTY output is untrusted: an OSC 8 link must not raise a native confirm() or open a URL.
    linkHandler: { activate: () => undefined },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  const { onEscape } = options;
  if (onEscape !== undefined) {
    term.attachCustomKeyEventHandler((event) => {
      if (!isTerminalEscapeKey(event)) return true;
      event.preventDefault();
      onEscape();
      return false;
    });
  }
  term.open(host);
  host.orchtopusTerminal = term;
  try {
    const webgl = new WebglAddon();
    // Context loss: dispose the addon and xterm falls back to the DOM renderer. The CSP blocks
    // the style attributes that renderer sets for 24-bit colours, so such text shows in the
    // default terminal colour; palette colours, layout and input keep working.
    webgl.onContextLoss(() => {
      webgl.dispose();
    });
    term.loadAddon(webgl);
  } catch {
    // No WebGL: the DOM renderer stays.
  }
  const safeFit = (): void => {
    if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
  };
  safeFit();

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const retheme = (): void => {
    term.options.theme = buildXtermTheme(readToken);
  };
  media.addEventListener('change', retheme);

  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(safeFit);
  });
  observer.observe(host);

  return {
    term,
    dispose: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener('change', retheme);
      delete host.orchtopusTerminal;
      term.dispose();
    },
  };
}

// Keyboard rules for a terminal: it takes focus only when no other control holds it, and F6
// (the Windows key for the next pane) leaves it, because xterm keeps Tab and Shift+Tab for the
// PTY. F6 without modifiers means nothing to Claude Code.

/** The key that moves focus out of a terminal; checked on keydown only. */
export function isTerminalEscapeKey(event: KeyboardEvent): boolean {
  return (
    event.type === 'keydown' &&
    event.key === 'F6' &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.metaKey
  );
}

/**
 * Whether a terminal that just attached may take focus: only when nothing holds focus or focus
 * is already in its own frame (the Reattach button). A row reached by arrow keys keeps it.
 */
export function mayTakeFocus(
  active: Element | null,
  body: Element | null,
  frame: Pick<Node, 'contains'> | null,
): boolean {
  if (active === null || active === body) return true;
  return frame?.contains(active) ?? false;
}

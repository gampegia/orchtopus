import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import type { SessionView } from '../../shared/api-types';
import { SessionHeader } from './SessionHeader';
import { SessionPane } from './SessionPane';
import { TerminalView } from './TerminalView';

function session(id: string, task: string): SessionView {
  return { id, task } as SessionView;
}

function children(element: ReactElement): ReactElement[] {
  const props = element.props as { children: ReactElement | ReactElement[] };
  return Array.isArray(props.children) ? props.children : [props.children];
}

describe('SessionPane', () => {
  // Local state (error text, stopping flag, remove dialog, terminal) must not carry over
  // to another session, so React has to remount both parts when the selection changes.
  it('keys the header and the terminal by session id', () => {
    const pane = SessionPane({ session: session('upload-fix-1', 'upload-fix') });
    const parts = children(pane);
    expect(parts.map((part) => part.type)).toEqual([SessionHeader, TerminalView]);
    expect(parts.map((part) => part.key)).toEqual(['upload-fix-1:header', 'upload-fix-1:terminal']);
  });

  it('gives another session other keys', () => {
    const first = children(SessionPane({ session: session('upload-fix-1', 'upload-fix') }));
    const second = children(SessionPane({ session: session('report-export-1', 'report-export') }));
    for (const [index, part] of second.entries()) {
      expect(part.key).not.toBe(first[index]?.key);
    }
  });

  // Siblings with the same key make React keep a stale element in the DOM.
  it('never gives the two siblings the same key', () => {
    const keys = children(SessionPane({ session: session('upload-fix-1', 'upload-fix') })).map(
      (part) => part.key,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

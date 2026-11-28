import { describe, expect, it } from 'vitest';
import { isTerminalEscapeKey, mayTakeFocus } from './terminal-focus';

const key = (overrides: Partial<KeyboardEvent>): KeyboardEvent =>
  ({
    type: 'keydown',
    key: 'F6',
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides,
  }) as KeyboardEvent;

describe('isTerminalEscapeKey', () => {
  it('is F6 on keydown', () => {
    expect(isTerminalEscapeKey(key({}))).toBe(true);
  });

  it('ignores keyup, so the terminal gets no stray F6', () => {
    expect(isTerminalEscapeKey(key({ type: 'keyup' }))).toBe(false);
  });

  it('ignores F6 with a modifier and other keys', () => {
    expect(isTerminalEscapeKey(key({ shiftKey: true }))).toBe(false);
    expect(isTerminalEscapeKey(key({ ctrlKey: true }))).toBe(false);
    expect(isTerminalEscapeKey(key({ key: 'Tab' }))).toBe(false);
    expect(isTerminalEscapeKey(key({ key: 'ArrowLeft', altKey: true }))).toBe(false);
  });
});

describe('mayTakeFocus', () => {
  const body = { id: 'body' } as unknown as Element;
  const inside = { id: 'inside' } as unknown as Element;
  const row = { id: 'row' } as unknown as Element;
  const frame = { contains: (node: Node | null) => node === (inside as unknown as Node) };

  it('takes focus when nothing has it', () => {
    expect(mayTakeFocus(null, body, frame)).toBe(true);
    expect(mayTakeFocus(body, body, frame)).toBe(true);
  });

  it('takes focus back from inside its own frame (Reattach)', () => {
    expect(mayTakeFocus(inside, body, frame)).toBe(true);
  });

  it('leaves focus on a session row or any other control', () => {
    expect(mayTakeFocus(row, body, frame)).toBe(false);
  });

  it('leaves focus alone without a frame', () => {
    expect(mayTakeFocus(row, body, null)).toBe(false);
  });
});

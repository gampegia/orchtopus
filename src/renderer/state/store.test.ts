import { describe, expect, it } from 'vitest';
import type { ProjectView, SessionView } from '../../shared/api-types';
import { initialClientState, type ClientState } from '../../shared/client-state';
import { keepSelection, nextConnection } from './store';

function session(id: string, projectId: string): SessionView {
  return { id, projectId } as SessionView;
}

function project(id: string): ProjectView {
  return { id } as ProjectView;
}

function state(projects: string[], sessions: [string, string][]): ClientState {
  return {
    ...initialClientState(),
    projects: projects.map(project),
    sessions: sessions.map(([id, projectId]) => session(id, projectId)),
  };
}

describe('nextConnection', () => {
  it('stays connecting while the first connection is not open yet', () => {
    expect(nextConnection('connecting', 'connecting')).toBe('connecting');
    expect(nextConnection('connecting', 'closed')).toBe('connecting');
  });

  it('is connected once the stream opens', () => {
    expect(nextConnection('connecting', 'open')).toBe('connected');
    expect(nextConnection('lost', 'open')).toBe('connected');
  });

  // Plan requirement: a drop after a working connection shows "API connection lost".
  it('is lost after a working connection drops, and stays lost while it reconnects', () => {
    expect(nextConnection('connected', 'closed')).toBe('lost');
    expect(nextConnection('lost', 'connecting')).toBe('lost');
    expect(nextConnection('lost', 'closed')).toBe('lost');
  });
});

describe('keepSelection', () => {
  const twoProjects = state(
    ['acme-app', 'acme-web'],
    [
      ['report-export', 'acme-web'],
      ['upload-fix', 'acme-app'],
    ],
  );

  it('keeps the selection while the session exists', () => {
    expect(keepSelection(twoProjects, 'report-export')).toBe('report-export');
  });

  it('falls back to the first row in list order when the session is gone', () => {
    expect(keepSelection(twoProjects, 'image-resize')).toBe('upload-fix');
    expect(keepSelection(twoProjects, null)).toBe('upload-fix');
  });

  it('selects nothing when there are no sessions', () => {
    expect(keepSelection(state(['acme-app'], []), 'upload-fix')).toBeNull();
  });
});

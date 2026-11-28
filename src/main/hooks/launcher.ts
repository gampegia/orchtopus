// The launcher <data>\bin\orchtopus-hook.cmd that every hook and the status line call (spec
// section 5, check T6). It runs the helper next to it with the Orchtopus executable in Node mode
// and exits 0 when either is gone, so a removed Orchtopus never blocks a session.
//
// cmd.exe reads a batch file in the OEM code page, so UTF-8 text in it breaks on a non-ASCII
// path. The helper is therefore named through %~dp0 (the launcher's own folder, expanded by cmd
// itself), and only when the executable path is not ASCII the file switches to UTF-8 first; an
// ASCII path gets no chcp, which keeps the call fast.
import { basename } from 'node:path';

export interface LauncherInput {
  exePath: string;
  /** The helper bundle; it must live in the launcher's folder. Only its file name is used. */
  helperPath: string;
}

/** `%` would start a variable inside a batch file; doubled, it stays a literal. */
function escapePercent(text: string): string {
  return text.replaceAll('%', '%%');
}

function checkPath(kind: string, path: string): string {
  if (path === '' || /["\r\n\0]/.test(path)) {
    throw new Error(`${kind} path cannot be written into the launcher`);
  }
  return path;
}

function isAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

export function renderLauncher(input: LauncherInput): string {
  const exe = escapePercent(checkPath('executable', input.exePath));
  const helper = `%~dp0${escapePercent(checkPath('helper', basename(input.helperPath)))}`;
  const lines = [
    '@echo off',
    ...(isAscii(input.exePath) ? [] : ['chcp 65001 >nul']),
    'setlocal DisableDelayedExpansion',
    `if not exist "${exe}" exit /b 0`,
    `if not exist "${helper}" exit /b 0`,
    'set ELECTRON_RUN_AS_NODE=1',
    `"${exe}" "${helper}" %*`,
    'exit /b %ERRORLEVEL%',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

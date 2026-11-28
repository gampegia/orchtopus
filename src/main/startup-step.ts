/**
 * Runs a startup step that must not stop the app from starting.
 * A failure is logged and the step is retried on a later start or import.
 */
export async function tryStartupStep<T>(
  label: string,
  run: () => Promise<T>,
  warn: (message: string) => void,
): Promise<T | null> {
  try {
    return await run();
  } catch (error: unknown) {
    warn(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

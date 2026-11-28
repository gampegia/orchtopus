import { builtinModules } from 'node:module';
import { basename, dirname } from 'node:path';
import { build, type Plugin } from 'vite';

/** Which entry to bundle and where the single output file goes. Both paths are absolute. */
export interface StandaloneBundleOptions {
  readonly entry: string;
  readonly outFile: string;
}

const NODE_BUILTINS = [/^node:/, ...builtinModules];

/**
 * Bundles one entry into a single CommonJS file that needs only Node built-ins.
 * A second input of the main build would share chunks with index.js, and the hook helper is
 * copied alone into <data>\bin\, so it gets its own build.
 */
export async function buildStandaloneCjs(options: StandaloneBundleOptions): Promise<void> {
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: dirname(options.outFile),
      emptyOutDir: false,
      target: 'node24',
      minify: false,
      sourcemap: false,
      copyPublicDir: false,
      lib: {
        entry: options.entry,
        formats: ['cjs'],
        fileName: () => basename(options.outFile),
      },
      rolldownOptions: { external: NODE_BUILTINS },
    },
  });
}

/** Runs buildStandaloneCjs after each main build (also in dev watch mode). */
export function standaloneBundlePlugin(options: StandaloneBundleOptions): Plugin {
  return {
    name: 'orchtopus-standalone-bundle',
    apply: 'build',
    async closeBundle() {
      await buildStandaloneCjs(options);
    },
  };
}

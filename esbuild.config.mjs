import * as esbuild from 'esbuild';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isProduction = process.argv.includes('production');
const entry = 'src/main.js';
const outfile = 'main.js';

const buildOptions = {
  entryPoints: [entry],
  bundle: true,
  format: 'cjs',
  target: 'es2021',
  platform: 'browser',
  external: ['obsidian', 'electron', ...builtinModules],
  outfile: outfile,
  logLevel: 'info',
  alias: {
    'fs': resolve(__dirname, 'scripts/lib/shims/empty-fs.cjs'),
    'fs/promises': resolve(__dirname, 'scripts/lib/shims/empty-fs.cjs'),
    'immediate': resolve(__dirname, 'scripts/lib/shims/immediate-shim.cjs'),
    'setimmediate': resolve(__dirname, 'scripts/lib/shims/immediate-shim.cjs'),
    'jszip': resolve(__dirname, 'node_modules/jszip/lib/index.js'),
  },
};

if (isProduction) {
  buildOptions.minifyWhitespace = true;
  buildOptions.minifySyntax = true;
} else {
  buildOptions.sourcemap = 'inline';
  buildOptions.watch = {
    onRebuild(error) {
      if (error) console.error('watch build failed:', error);
      else console.log('watch build finished');
    },
  };
}

if (isProduction) {
  await esbuild.build(buildOptions);
  console.log('Production build complete ->', outfile);
} else {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Dev build watching', entry, '->', outfile);
}

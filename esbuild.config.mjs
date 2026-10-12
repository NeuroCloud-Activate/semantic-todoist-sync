import * as esbuild from 'esbuild';
import { builtinModules } from 'module';

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

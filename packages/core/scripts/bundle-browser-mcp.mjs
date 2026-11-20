import esbuild from 'esbuild';
import fs from 'node:fs'; // Import the full fs module
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);

/**
 * Locate chrome-devtools-mcp's compiled entry point and package root.
 *
 * The package has moved its build output before: build/src/index.js up to 1.9.x,
 * out/Default/gen/src/index.js from 1.10.x. A hardcoded path turns that into a
 * build failure far from the cause, and because npm run build aborts before
 * npm run bundle, the launcher keeps running the previous bundle. Resolving
 * through require honours whatever package.json names as main, so a future move
 * needs no change here.
 */
function resolveChromeDevtoolsMcp() {
  const entryPoint = require.resolve('chrome-devtools-mcp');
  if (!fs.existsSync(entryPoint)) {
    throw new Error(
      `chrome-devtools-mcp resolves to ${entryPoint} but no file is there` +
        ' - check the installed version and its package.json main field',
    );
  }

  // package.json is the authority for the layout: the nearest one above the
  // entry point is the package root (its files list ships out/Default/gen/src).
  let pkgRoot = path.dirname(entryPoint);
  while (!fs.existsSync(path.join(pkgRoot, 'package.json'))) {
    const parent = path.dirname(pkgRoot);
    if (parent === pkgRoot) {
      throw new Error(
        `could not find chrome-devtools-mcp package.json above ${entryPoint}`,
      );
    }
    pkgRoot = parent;
  }
  return { entryPoint, pkgRoot };
}

const manifestPath = path.resolve(
  __dirname,
  '../src/agents/browser/browser-tools-manifest.json',
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

// Only exclude tools explicitly mentioned in the manifest's exclude list
const excludedToolsFiles = (manifest.exclude || []).map((t) => t.name);

// Basic esbuild plugin to empty out excluded modules
const emptyModulePlugin = {
  name: 'empty-modules',
  setup(build) {
    // chrome-devtools-mcp's prebuilt third_party bundle imports two packages that
    // are neither published to npm nor declared in its package.json, so esbuild
    // cannot resolve them and the whole build step fails. Measured: 1.9.0, 1.10.0
    // and 1.10.1 all carry the imports, so no 1.x pin avoids it; only the 0.x line
    // does. They are reached only from code paths this bundle never takes, so they
    // resolve to an empty module - the same treatment the excluded tools get below.
    // Specifiers the prebuilt third_party bundle cannot resolve. Each is reached
    // only from a code path this bundle never takes, so it resolves to an empty
    // module instead of failing the whole build:
    //   * phantom optional deps - imported by the prebuilt bundle but neither
    //     published to npm nor declared by chrome-devtools-mcp (its dependencies
    //     field is null);
    //   * a path into puppeteer-core's own BUILD tree, which cannot exist under
    //     node_modules and is used only for WebDriver BiDi, not the CDP flow here.
    const unresolvableSpecifiers = [
      new RegExp('^(@toon-format/toon|@blackwell-systems/gcf|modern-tar)(/|$)'),
      new RegExp('node_modules/puppeteer-core/lib/puppeteer/bidi/bidi[.]js$'),
    ];
    for (const filter of unresolvableSpecifiers) {
      build.onResolve({ filter }, (args) => ({
        path: args.path,
        namespace: 'empty',
      }));
    }

    if (excludedToolsFiles.length === 0) return;

    // Create a filter that matches any of the excluded tools
    const excludeFilter = new RegExp(`(${excludedToolsFiles.join('|')})\\.js$`);

    build.onResolve({ filter: excludeFilter }, (args) => {
      // Check if we are inside a tools directory to avoid accidental matches
      if (
        args.importer.includes('chrome-devtools-mcp') &&
        /[\\/]tools[\\/]/.test(args.importer)
      ) {
        return { path: args.path, namespace: 'empty' };
      }
      return null;
    });

    build.onLoad({ filter: /.*/, namespace: 'empty' }, (_args) => ({
      contents: 'export {};', // Empty module (ESM)
      loader: 'js',
    }));
  },
};

async function bundle() {
  try {
    const { entryPoint, pkgRoot } = resolveChromeDevtoolsMcp();
    await esbuild.build({
      entryPoints: [entryPoint],
      bundle: true,
      outfile: path.resolve(
        __dirname,
        '../dist/bundled/chrome-devtools-mcp.mjs',
      ),
      format: 'esm',
      platform: 'node',
      plugins: [emptyModulePlugin],
      external: [
        'puppeteer-core',
        '/bundled/*',
        '../../../node_modules/puppeteer-core/*',
      ],
      banner: {
        js: 'import { createRequire as __createRequire } from "module"; const require = __createRequire(import.meta.url);',
      },
    });

    // Copy third_party assets
    // third_party sits BESIDE the compiled entry point, so it moves with it.
    // The second candidate is the pre-1.10 layout, kept so an older pin still
    // bundles its assets instead of silently dropping them.
    const thirdPartyCandidates = [
      path.join(path.dirname(entryPoint), 'third_party'),
      path.join(pkgRoot, 'build/src/third_party'),
    ];
    const srcThirdParty = thirdPartyCandidates.find((dir) =>
      fs.existsSync(dir),
    );
    const destThirdParty = path.resolve(
      __dirname,
      '../dist/bundled/third_party',
    );

    if (srcThirdParty) {
      if (fs.existsSync(destThirdParty)) {
        fs.rmSync(destThirdParty, { recursive: true, force: true });
      }
      fs.cpSync(srcThirdParty, destThirdParty, {
        recursive: true,
        filter: (src) => {
          // Skip large/unnecessary bundles that are either explicitly excluded
          // or not required for the browser agent functionality.
          return (
            !src.includes('lighthouse-devtools-mcp-bundle.js') &&
            !src.includes('devtools-formatter-worker.js')
          );
        },
      });
    } else {
      console.warn(
        `Warning: third_party assets not found (looked in ${thirdPartyCandidates.join(', ')})`,
      );
    }
  } catch (error) {
    console.error('Error bundling chrome-devtools-mcp:', error);
    process.exit(1);
  }
}

bundle();

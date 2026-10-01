import esbuild from 'esbuild';
import fs from 'node:fs'; // Import the full fs module
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    const phantomOptionalDeps = /^(@toon-format\/toon|@blackwell-systems\/gcf)(\/|$)/;
    build.onResolve({ filter: phantomOptionalDeps }, (args) => ({
      path: args.path,
      namespace: 'empty',
    }));

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
    const entryPoint = path.resolve(
      __dirname,
      '../../../node_modules/chrome-devtools-mcp/build/src/index.js',
    );
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
    const srcThirdParty = path.resolve(
      __dirname,
      '../../../node_modules/chrome-devtools-mcp/build/src/third_party',
    );
    const destThirdParty = path.resolve(
      __dirname,
      '../dist/bundled/third_party',
    );

    if (fs.existsSync(srcThirdParty)) {
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
      console.warn(`Warning: third_party assets not found at ${srcThirdParty}`);
    }
  } catch (error) {
    console.error('Error bundling chrome-devtools-mcp:', error);
    process.exit(1);
  }
}

bundle();

// Creature Lab app boundary (extraction plan phase 4a): code under apps/ may import only apps/**, the kit's src/** and
// three (`three`, `three/addons/...`). Nothing from universe-atlas, no other package, no Node built-ins.
// Build configuration is tooling, not app code: apps/*/vite.config.{js,mjs,ts} may also import `vite` and `node:*`.
// HTML pages may load scripts and stylesheets only from inside apps/ (relative URLs; base './').
// tests/creature-core-boundary.test.mjs (the core's own boundary) is separate and unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {dirname, extname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = resolve(KIT, 'apps'), SRC = resolve(KIT, 'src');
const CODE = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite']);
const isConfig = file => /^vite\.config\.(js|mjs|ts)$/.test(file.split(/[\\/]/).at(-1));
const inside = (dir, path) => path === dir || path.startsWith(dir + sep);

/** Files under apps/, skipping build output and caches. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(resolve(dir, entry.name), out); }
    else out.push(resolve(dir, entry.name));
  }
  return out;
}

/** Every module specifier a file depends on: import/export-from, import('x'), import x = require('x'), import types, require('x'). */
function moduleSpecifiers(name, text) {
  const sf = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
      const arg = node.arguments[0]; out.push(ts.isStringLiteralLike(arg) ? arg.text : `<dynamic import: ${arg.getText(sf)}>`);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const e = node.moduleReference.expression; out.push(ts.isStringLiteralLike(e) ? e.text : `<require: ${e.getText(sf)}>`);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) out.push(node.argument.literal.text);
    else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const arg = node.arguments[0]; out.push(arg && ts.isStringLiteralLike(arg) ? arg.text : '<require: non-literal>');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Why `spec`, imported from `file`, breaks the boundary; null when it is allowed. */
export function boundaryViolation(file, spec) {
  if (spec.startsWith('<')) return 'non-literal module specifier';
  if (spec === 'three' || spec.startsWith('three/')) return null;
  if (isConfig(file) && (spec === 'vite' || spec.startsWith('node:'))) return null;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const target = resolve(dirname(file), spec.split(/[?#]/)[0]);
    return inside(APPS, target) || inside(SRC, target) ? null : `resolves outside apps/ and src/: ${relative(KIT, target).replaceAll('\\', '/')}`;
  }
  return `not allowed (apps/ may import apps/**, src/** and three${isConfig(file) ? '; its build config also vite and node:*' : ''})`;
}

/** Script and stylesheet URLs an HTML page loads, which must stay inside apps/. */
function htmlViolations(file, text) {
  const out = [];
  for (const m of text.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const url = m[1];
    if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:')) { out.push(`${url}: absolute or external URL`); continue; }
    const target = resolve(dirname(file), url.split(/[?#]/)[0]);
    if (!inside(APPS, target)) out.push(`${url}: resolves outside apps/`);
  }
  return out;
}

test('apps/** imports only apps/**, src/** and three', () => {
  const files = walk(APPS), violations = [];
  let code = 0, html = 0;
  for (const file of files) {
    const rel = relative(KIT, file).replaceAll('\\', '/'), ext = extname(file);
    if (CODE.has(ext)) {
      code++;
      for (const spec of moduleSpecifiers(file, readFileSync(file, 'utf8'))) { const why = boundaryViolation(file, spec); if (why) violations.push(`${rel}: "${spec}" ${why}`); }
    } else if (ext === '.html') {
      html++;
      for (const why of htmlViolations(file, readFileSync(file, 'utf8'))) violations.push(`${rel}: ${why}`);
    } else if (ext === '.css') {
      for (const m of readFileSync(file, 'utf8').matchAll(/@import\s+(?:url\()?["']?([^"')\s;]+)/g)) {
        const target = resolve(dirname(file), m[1]); if (!inside(APPS, target)) violations.push(`${rel}: @import ${m[1]} resolves outside apps/`);
      }
    }
  }
  assert.ok(code >= 6 && html >= 1, `scanned ${code} code files and ${html} pages under apps/`);
  assert.deepEqual(violations, [], `apps/ boundary violations:\n${violations.join('\n')}`);
});

test('the boundary check rejects what it should (negative cases)', () => {
  const app = resolve(APPS, 'creature-lab', 'src', 'main.ts'), config = resolve(APPS, 'creature-lab', 'vite.config.mjs');
  for (const spec of ['./creature-lab-state.ts', '../../../src/fauna-composer.ts', 'three', 'three/addons/controls/OrbitControls.js'])
    assert.equal(boundaryViolation(app, spec), null, spec);
  for (const spec of ['../../../../universe-atlas/src/surface-lighting.ts', '../../../tests/helpers/gpu-lock.mjs', '../../../package.json',
    'vite', 'node:fs', 'fs', 'lodash', '@iwsdk/core', '/src/fauna-composer.ts', '<dynamic import: name>', 'C:/LLM/IWSDK/universe-atlas/src/x.ts'])
    assert.ok(boundaryViolation(app, spec), `must reject ${spec}`);
  assert.equal(boundaryViolation(config, 'vite'), null); assert.equal(boundaryViolation(config, 'node:path'), null);
  assert.ok(boundaryViolation(config, 'lodash')); assert.ok(boundaryViolation(config, '../../../universe-atlas/vite.config.ts'));
  const page = resolve(APPS, 'creature-lab', 'creature-lab.html');
  assert.deepEqual(htmlViolations(page, '<script type="module" src="./src/main.ts"></script><link rel="stylesheet" href="./src/creature-lab.css">'), []);
  assert.equal(htmlViolations(page, '<script src="/src/creature-lab.ts"></script><script src="../../src/x.ts"></script><script src="https://cdn.example/x.js"></script>').length, 3);
  const found = moduleSpecifiers('x.ts', "import a from 'a';export {b} from 'b';const c=await import('c');type D=import('d').D;const e=require('e');import f=require('f');const g=await import(name);");
  assert.deepEqual(found, ['a', 'b', 'c', 'd', 'e', 'f', '<dynamic import: name>']);
});

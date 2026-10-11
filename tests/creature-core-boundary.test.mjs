// Creature-kit phase 1: lock the composer core's package boundary without moving any file.
// The 13 modules below (plan: C:/LLM/IWSDK/docs/creature-kit-extraction-plan-2026-10-04.md) form a closed set today: they import only each other and `three`. This test keeps it that way, and pins the exported
// names of each module so an accidental public-API change fails with a readable diff.
//
// Regenerate the export snapshot after an INTENDED API change:
//   node tests/creature-core-boundary.test.mjs --update-creature-boundary
//   (or UPDATE_CREATURE_BOUNDARY=1 node --test tests/creature-core-boundary.test.mjs)
// and commit tests/fixtures/creature-core-exports.json with the change that caused it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {posix} from 'node:path';
import ts from 'typescript';

export const CREATURE_CORE_MODULES = Object.freeze([
  'fauna-coat-fields.ts',
  'fauna-coat-juvenile.ts',
  'fauna-coat-crisp-glsl.ts',
  'fauna-coat-vocab.ts',
  'fauna-composer-eye-catalogue.ts',
  'fauna-composer-eye.ts',
  'fauna-composer-face-geometry.ts',
  'fauna-composer-face.ts',
  'fauna-composer-individual.ts',
  'fauna-composer-mesh.ts',
  'fauna-composer-phenotype.ts',
  'fauna-composer-recipe.ts',
  'fauna-composer-rig.ts',
  'fauna-composer-species.ts',
  'fauna-composer-source.ts',
  'fauna-composer.ts',
]);
const ALLOWED_EXTERNAL = new Set(['three']);
const SNAPSHOT_URL = new URL('./fixtures/creature-core-exports.json', import.meta.url);
const SNAPSHOT_SCHEMA = 'creature-core-exports-1';
const UPDATE = process.argv.includes('--update-creature-boundary') || process.env.UPDATE_CREATURE_BOUNDARY === '1';
const REGEN = 'node tests/creature-core-boundary.test.mjs --update-creature-boundary';

const parse = name => {
  const text = readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
};

/** Every module specifier the file depends on: static import/export-from, import('x'), import x = require('x'). */
export function moduleSpecifiers(sf) {
  const out = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
      const arg = node.arguments[0];
      out.push(ts.isStringLiteralLike(arg) ? arg.text : `<dynamic import: ${arg.getText(sf)}>`);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const e = node.moduleReference.expression;
      out.push(ts.isStringLiteralLike(e) ? e.text : `<require: ${e.getText(sf)}>`);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      out.push(node.argument.literal.text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const arg = node.arguments[0];
      out.push(arg && ts.isStringLiteralLike(arg) ? arg.text : '<require: non-literal>');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const hasExport = node => !!ts.getModifiers?.(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
const hasDefault = node => !!ts.getModifiers?.(node)?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);

/** Exported names split into runtime values and type-only names. Re-exports are recorded by their exported name. */
export function exportedNames(sf) {
  const values = new Set(), types = new Set();
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      if (!st.exportClause) { values.add(`* from ${st.moduleSpecifier?.text}`); continue; }
      if (ts.isNamespaceExport(st.exportClause)) { values.add(st.exportClause.name.text); continue; }
      for (const el of st.exportClause.elements) (st.isTypeOnly || el.isTypeOnly ? types : values).add(el.name.text);
    } else if (ts.isExportAssignment(st)) {
      values.add('default');
    } else if (hasExport(st)) {
      if (hasDefault(st)) { values.add('default'); continue; }
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) values.add(d.name.text);
          else for (const el of d.name.elements) if (!ts.isOmittedExpression(el) && ts.isIdentifier(el.name)) values.add(el.name.text);
        }
      } else if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) types.add(st.name.text);
      else if (st.name && ts.isIdentifier(st.name)) values.add(st.name.text); // function, class, enum, namespace
    }
  }
  return {values: [...values].sort(), types: [...types].sort()};
}

const sources = Object.fromEntries(CREATURE_CORE_MODULES.map(name => [name, parse(name)]));

test('creature core: the 13 composer modules import only each other and three', () => {
  const core = new Set(CREATURE_CORE_MODULES);
  const leaks = [];
  for (const [name, sf] of Object.entries(sources)) {
    for (const spec of moduleSpecifiers(sf)) {
      if (ALLOWED_EXTERNAL.has(spec)) continue;
      const local = /^\.\/([^/]+\.ts)$/.exec(spec);
      if (local && core.has(local[1])) continue;
      leaks.push(`  src/${name} imports '${spec}'`);
    }
  }
  assert.equal(leaks.length, 0,
    `Creature core boundary broken: these imports leave the 13-module composer core (allowed: each other via './<file>.ts', and 'three').\n`
    + `${leaks.join('\n')}\n`
    + `Move the dependency into the core, pass the value in from the caller, or (owner decision) extend CREATURE_CORE_MODULES.`);
});

// creature-kit: the package boundary is "src/** imports only src/** and three". src/ holds the 12 core modules plus the
// GLB exporter and the LOD reducer (which the core must not import; tests/fauna-composer-export.test.mjs checks that).
test('creature-kit: every src/** module imports only other src/** modules and three', () => {
  const srcDir = new URL('../src/', import.meta.url);
  const files = readdirSync(srcDir, {recursive: true}).map(String).map(f => f.replace(/\\/g, '/')).filter(f => /\.(ts|mts|js|mjs)$/.test(f)).sort();
  assert.ok(files.length >= CREATURE_CORE_MODULES.length, 'src/ holds at least the core');
  const all = new Set(files), leaks = [];
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(new URL(file, srcDir), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const spec of moduleSpecifiers(sf)) {
      if (ALLOWED_EXTERNAL.has(spec)) continue;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const target = posix.normalize(posix.join(posix.dirname(file), spec));
        if (!target.startsWith('../') && all.has(target)) continue;
      }
      leaks.push(`  src/${file} imports '${spec}'`);
    }
  }
  assert.equal(leaks.length, 0, `creature-kit boundary broken (allowed: relative imports of files inside src/, and 'three'):\n${leaks.join('\n')}`);
});

test('creature core: the parsed runtime export names equal the modules\' actual runtime exports', async () => {
  for (const [name, sf] of Object.entries(sources)) {
    const runtime = Object.keys(await import(new URL(`../src/${name}`, import.meta.url).href)).sort();
    assert.deepEqual(exportedNames(sf).values, runtime, `export parser disagrees with the runtime module for src/${name}`);
  }
});

test('creature core: exported-name snapshot matches tests/fixtures/creature-core-exports.json', () => {
  const current = {schema: SNAPSHOT_SCHEMA, regenerate: REGEN, modules: Object.fromEntries(Object.entries(sources).map(([n, sf]) => [n, exportedNames(sf)]))};
  if (UPDATE) {
    writeFileSync(SNAPSHOT_URL, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`creature-core-boundary: wrote ${SNAPSHOT_URL.pathname}`);
    return;
  }
  const pinned = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8'));
  assert.equal(pinned.schema, SNAPSHOT_SCHEMA);
  const drift = [];
  const names = new Set([...Object.keys(pinned.modules), ...Object.keys(current.modules)]);
  for (const mod of [...names].sort()) {
    const was = pinned.modules[mod], now = current.modules[mod];
    if (!was) { drift.push(`  ${mod}: module is new to the snapshot`); continue; }
    if (!now) { drift.push(`  ${mod}: module is in the snapshot but no longer in CREATURE_CORE_MODULES`); continue; }
    for (const kind of ['values', 'types']) {
      const a = new Set(was[kind]), b = new Set(now[kind]);
      const removed = [...a].filter(x => !b.has(x)), added = [...b].filter(x => !a.has(x));
      if (removed.length) drift.push(`  ${mod} ${kind} removed: ${removed.join(', ')}`);
      if (added.length) drift.push(`  ${mod} ${kind} added: ${added.join(', ')}`);
    }
  }
  assert.equal(drift.length, 0,
    `Creature core public surface drifted from the pinned snapshot:\n${drift.join('\n')}\n`
    + `If the change is intended, regenerate with: ${REGEN}\nand commit tests/fixtures/creature-core-exports.json in the same commit.`);
});

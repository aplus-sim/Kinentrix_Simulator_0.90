// build.js - template.html + covariate modules + specs/*.json -> a single self-contained HTML app
//
//   node covariate/app/build.js
//   node covariate/app/build.js --only pembrolizumab      # include one drug only
//   node covariate/app/build.js --out ../../dist/keytruda.html
//
// The output is self-contained - no CDN, no fetch, no external files - so it opens by double-click.
// To add a drug: add specs/<drug>.json and re-run this script. No code changes needed.
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;                                  // covariate/app
const COV = path.resolve(DIR, '..');                    // covariate
const SPECS_DIR = path.join(COV, 'specs');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const ONLY = arg('only', null);
const OUT = path.resolve(DIR, arg('out', 'keytruda_simulator.html'));

// ------------------------------------------------------------------ specs
const specFiles = fs.readdirSync(SPECS_DIR).filter(f => f.endsWith('.json')).sort();
const specs = {};
const included = [];
specFiles.forEach(fn => {
  const spec = JSON.parse(fs.readFileSync(path.join(SPECS_DIR, fn), 'utf8'));
  if (ONLY && spec.drug !== ONLY) return;
  const key = path.basename(fn, '.json');
  // Documentation-only keys (leading _) are dropped to keep the file small,
  // except _source, which the app displays as the model's provenance.
  const slim = {};
  Object.keys(spec).forEach(k => { if (!k.startsWith('_') || k === '_source') slim[k] = spec[k]; });
  specs[key] = slim;
  included.push(`${key}  (drug=${spec.drug}, ${spec.effects.filter(e => e.enabled).length}/${spec.effects.length} effects enabled)`);
});
if (!included.length) throw new Error('No specs to include: ' + SPECS_DIR + (ONLY ? ` (--only ${ONLY})` : ''));

// ---------------------------------------------------------------- modules
// They are written as UMD, so concatenating them yields window.CovModel / Vpop / PKSim.
const MODULES = ['covmodel.js', 'vpop.js', 'pksim.js']
  .map(f => `/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(COV, f), 'utf8'))
  .join('\n\n');

// ---------------------------------------------------------------- assemble
const drugs = [...new Set(Object.values(specs).map(s => s.drug))];
const title = 'KINENTRIX Simulator';

// base64 data URI for a file in ../assets
const dataUri = (name) =>
  'data:image/png;base64,' +
  fs.readFileSync(path.join(DIR, '..', 'assets', name)).toString('base64');

let html = fs.readFileSync(path.join(DIR, 'template.html'), 'utf8');
html = html
  .replace(/__TITLE__/g, title)
  .replace('__MODULES__', () => MODULES)
  .replace('__SPECS__', () => JSON.stringify(specs, null, 1))
  // the drug catalogue: every antibody in the library, so the list shows what exists beyond the
  // sourced models (names and counts only - no parameters)
  // the two embedded faces (Inter for the interface, Geist for headings), base64 woff2;
  // regenerate with tools/make_fonts.py after changing the on-screen text
  // the official logo files, inlined so the single file stays self-contained
  .replace('__LOGO_LIGHT__', () => dataUri('kinentrix_lockup_light.png'))
  .replace('__LOGO_DARK__', () => dataUri('kinentrix_lockup_dark.png'))
  .replace('__FONTS__', () => fs.readFileSync(path.join(DIR, 'fonts.css'), 'utf8').trim())
  .replace('__CATALOG__', () => fs.readFileSync(path.join(DIR, 'drug_catalog.json'), 'utf8').trim());

fs.writeFileSync(OUT, html, 'utf8');

console.log(`\nBuild complete: ${OUT}  (${(html.length / 1024).toFixed(0)} KB)`);
console.log(`Title: ${title}`);
console.log(`${drugs.length} drug(s), ${included.length} spec(s)`);
included.forEach(s => console.log('  - ' + s));
console.log(`\nTo add a drug: add covariate/specs/<drug>.json and re-run this script\n`);

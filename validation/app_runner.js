// app_runner.js - runs the APP's own engine (covmodel.js + pksim.js + a spec) for a list of scenarios.
//
//   node validation/app_runner.js scenarios.json out.json
//
// Each scenario: { spec, cov, route: 'SC'|'IV', dose, loadDose?, tinf_h, tau, ndose, tend }
// Output per scenario: { params: typical individual parameters as the app builds them,
//                        times, conc } on the app's own time grid.
//
// modelOf / clFnOf below are copies of the same few lines in app/template.html (the engine glue that
// lives in the page). If those change in the template, change them here too.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CovModel = require(path.join(ROOT, 'covmodel.js'));
const PKSim = require(path.join(ROOT, 'pksim.js'));

function modelOf(spec, p, structure) {          // = template.html modelOf()
  const Vm = (p.VmPerVol != null) ? p.VmPerVol * p.Vc : (p.Vm != null ? p.Vm : (spec.Vm != null ? spec.Vm : null));
  const Km = (p.Km != null) ? p.Km : (spec.Km != null ? spec.Km : null);
  return { structure: structure || spec.structure, Km: Km, Vm: Vm };
}
function clFnOf(spec, p) {                        // = template.html clFnOf()
  const tv = spec.timeVarying;
  if (!tv || !tv.enabled || p.CL == null) return null;
  return (t) => p.CL * CovModel.timeFactor(tv, t);
}

const [inFile, outFile] = process.argv.slice(2);
const scenarios = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const out = scenarios.map(sc => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'specs', sc.spec + '.json'), 'utf8'));
  const typ = CovModel.build(spec, sc.cov || {}, {});
  const structure = { cmt: spec.structure.cmt, absorption: sc.route === 'SC' };
  const model = modelOf(spec, typ, structure);
  const tinf = sc.route === 'SC' ? 0 : (sc.tinf_h || 0) / 24;   // specs used here are all in days
  const dosing = { dose: sc.dose, loadDose: sc.loadDose, tinf, tau: sc.tau, ndose: sc.ndose, tend: sc.tend };
  const grid = PKSim.buildTimeGrid(dosing);
  const r = PKSim.simulate(model, typ, dosing, grid, { clFn: clFnOf(spec, typ) });
  const params = {};
  ['CL', 'Vc', 'Vp', 'Q', 'ka', 'F', 'Km', 'VmPerVol'].forEach(k => { if (typ[k] != null) params[k] = typ[k]; });
  if (spec.timeVarying && spec.timeVarying.enabled)
    params.tv = { type: spec.timeVarying.type, Emax: spec.timeVarying.Emax, T50: spec.timeVarying.T50, gamma: spec.timeVarying.gamma };
  return { id: sc.id, params, times: r.times, conc: r.conc };
});
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`app_runner: ${out.length} scenario(s) -> ${outFile}`);

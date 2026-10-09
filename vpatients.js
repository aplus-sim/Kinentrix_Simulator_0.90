// vpatients.js — 스펙 기준으로 가상환자를 뽑아 CSV로 저장 (idata 스타일)
//
//   node covariate/vpatients.js [--spec specs/pembrolizumab.json] [--n 1000] [--out vpatients.csv]
//                               [--tier upgraded|current|none]
//
// 앱의 "Export subjects"와 같은 형태지만 두 가지가 다르다:
//   1) 공변량 분포를 스펙의 population 블록에서 읽는다 (논문 출처가 붙어 있음)
//   2) 시드가 고정돼 있어 몇 번을 돌려도 같은 환자가 나온다 (보고서 재현성)
'use strict';

const fs = require('fs');
const path = require('path');
const CovModel = require('./covmodel.js');
const Vpop = require('./vpop.js');
const PKSim = require('./pksim.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const SPEC_PATH = path.resolve(__dirname, arg('spec', 'specs/pembrolizumab.json'));
const N = parseInt(arg('n', '1000'), 10);
const TIER = arg('tier', 'upgraded');
const OUT = path.resolve(__dirname, arg('out', 'vpatients.csv'));

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const TIERS = CovModel.tiers(spec);
if (!TIERS[TIER]) throw new Error('알 수 없는 tier: ' + TIER + ' (none|current|upgraded)');

const R = spec.regimen;
const dosing = {
  dose: R.dose, tinf: spec.timeUnit === 'day' ? R.tinf_h / 24 : R.tinf_h,
  tau: R.tau, ndose: R.ndose, tend: R.tend
};
const grid = PKSim.buildTimeGrid(dosing);
const model = { structure: spec.structure, Km: spec.Km || null, Vm: spec.Vm || null };

const subjects = Vpop.sample(spec.population, N);
const rng = new Vpop.RNG((spec.population.seed || 1) + 777);
const covNames = Object.keys(spec.population.covariates);

const rows = subjects.map((s, i) => {
  const typ = CovModel.build(spec, s, { only: TIERS[TIER].only });
  const ind = CovModel.sampleIndiv(spec, typ, rng);
  const r = PKSim.simulate(model, ind, dosing, grid);
  const m = PKSim.metricsFor(model, ind, r.times, r.conc, dosing);
  const row = { ID: i + 1 };
  covNames.forEach(k => { row[k] = s[k]; });
  row.CL = ind.CL; row.Vc = ind.Vc; row.Vp = ind.Vp; row.Q = ind.Q;
  row.CL_typical = typ.CL;                       // eta 적용 전(공변량만) — eta 크기 확인용
  row.Cmax = m.cmax; row.Cmax_ss = m.cmaxSS; row.Ctrough = m.ctrough;
  row.AUC = m.auc; row.AUC_tau = m.aucTau;
  row.thalf = m.thalf;              // 해석적 lambda_z (환자별 CL/V에서 계산)
  return row;
});

const cols = Object.keys(rows[0]);
const num = (v) => (typeof v === 'number') ? (Math.abs(v) >= 100 ? v.toFixed(1) : v.toPrecision(5)) : v;
const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => num(r[c])).join(','))).join('\n');
fs.writeFileSync(OUT, '﻿' + csv, 'utf8');   // BOM: Excel에서 한글/숫자 깨짐 방지

// ------------------------------------------------------------------ 요약
const S = (k) => Vpop.summary(rows.map(r => r[k]));
const f = (v, d = 2) => v == null ? '–' : Number(v).toFixed(d);
console.log(`\n가상환자 ${N}명 생성 — tier=${TIER}  (${TIERS[TIER].label})`);
console.log(`스펙: ${path.basename(SPEC_PATH)}  ·  시드 ${spec.population.seed} (재현 가능)`);
console.log(`용법: ${R.dose}mg q${R.tau}day IV, ${R.ndose}회\n`);
const show = ['WT', 'ALB', 'CL', 'Vc', 'Vp', 'Q', 'Cmax', 'Ctrough', 'AUC_tau'].filter(k => cols.indexOf(k) >= 0);
console.log('  ' + '항목'.padEnd(9) + '중앙값'.padStart(10) + '5–95%'.padStart(20) + 'CV'.padStart(9));
console.log('  ' + '-'.repeat(48));
show.forEach(k => {
  const s = S(k);
  if (!s) return;
  console.log('  ' + k.padEnd(9) + f(s.median, 3).padStart(10) +
    `${f(s.p5, 2)} – ${f(s.p95, 2)}`.padStart(20) + (f(s.cv, 1) + '%').padStart(9));
});
const nF = rows.filter(r => r.SEX === 'F').length;
if (cols.indexOf('SEX') >= 0) console.log('  ' + 'SEX'.padEnd(9) + `여성 ${nF}/${N} (${(nF / N * 100).toFixed(1)}%)`.padStart(30));
console.log(`\n  저장: ${OUT}`);
console.log(`  공변량 분포 출처: ${Object.entries(spec.population.covariates).map(([k, d]) => k + '=' + (String(d.source).startsWith('ASSUMPTION') ? '가정' : '논문')).join(', ')}\n`);

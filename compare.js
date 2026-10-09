// compare.js — 티어 비교 결과를 콘솔 표로 출력
//
//   node covariate/compare.js [--spec specs/pembrolizumab.json] [--n 2000] [--json out.json]
//
// 계산은 analysis.js가 하고 여기서는 찍기만 한다(같은 숫자를 report.js와 공유).
'use strict';

const fs = require('fs');
const path = require('path');
const { analyze } = require('./analysis.js');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const SPEC_PATH = path.resolve(__dirname, arg('spec', 'specs/pembrolizumab.json'));
const N = parseInt(arg('n', '2000'), 10);
const JSON_OUT = arg('json', null);

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const A = analyze(spec, { n: N });

const fmt = (v, d = 2) => (v == null || isNaN(v)) ? '–' : Number(v).toFixed(d);
const pct = (v, d = 1) => (v == null || isNaN(v)) ? '–' : (v * 100).toFixed(d) + '%';
const H = (t) => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)); };

function table(rows, headers) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const line = (c) => '  ' + c.map((x, i) => String(x).padEnd(w[i])).join('  ');
  console.log(line(headers));
  console.log('  ' + w.map(x => '-'.repeat(x)).join('  '));
  rows.forEach(r => console.log(line(r)));
}

console.log(`\n${A.brand || A.drug} 공변량 모델 비교 — 가상환자 ${A.n}명`);
console.log(`스펙: ${path.basename(SPEC_PATH)}`);

// ---------------------------------------------------------------- 1
H('[1] 회귀 확인 — 기존 index.html 엔진과 같은 값이 나오는가');
const R = A.dosing;
console.log(`  조건: ${R.dose}mg q${R.tau}day IV, ${R.ndose}회, ${R.tend}일 관찰`);
const ra = A.regression.appDefault, rr = A.regression.reference;
console.log(`  (a) 앱 기본 화면  WT=${ra.cov.WT} ALB=${ra.cov.ALB} SEX=${ra.cov.SEX} ← 성별 select 첫 옵션이 Female`);
console.log(`      CL=${fmt(ra.params.CL, 4)} L/day  Cmax=${fmt(ra.metrics.cmax, 1)}  Ctrough=${fmt(ra.metrics.ctrough, 1)} mg/L`);
const chk = A.regression.appCheck;
if (chk) {
  const tol = chk.tol || 1;
  const ok = Math.abs(ra.metrics.cmax - chk.cmax) < tol && Math.abs(ra.metrics.ctrough - chk.ctrough) < tol;
  console.log(`      앱 검증값 Cmax ${chk.cmax}·Ctrough ${chk.ctrough} 대조: ${ok ? 'OK — 엔진 이식 일치' : '★불일치'}`);
} else {
  console.log(`      (이 스펙은 앱에 실린 모델이 아니라 앱 회귀 대조 대상이 아님)`);
}
console.log(`  (b) 모델 기준환자 WT=${rr.cov.WT} ALB=${rr.cov.ALB} SEX=${rr.cov.SEX} (공변량 계수 전부 1)`);
console.log(`      CL=${fmt(rr.params.CL, 4)} L/day  Cmax=${fmt(rr.metrics.cmax, 1)}  Ctrough=${fmt(rr.metrics.ctrough, 1)} mg/L`);
console.log(`      3개 티어 Ctrough 일치: ${A.regression.tiersIdenticalAtReference ? 'OK' : '★불일치'}`);
console.log(`  ※ 앱 첫 화면은 여성 기준이라 모델 기준환자보다 노출이 ${pct(A.regression.femaleDefaultBias, 0)} 높게 보인다.`);

// ------------------------------------------------- 1b. 원문 보고값 자체검증
if (A.selfCheck && A.selfCheck.length) {
  H('[1b] 원문이 따로 보고한 값으로 자체 검증');
  const nOK = A.selfCheck.filter(c => c.inCI).length;
  const nTot = A.selfCheck.filter(c => c.inCI != null).length;
  table(A.selfCheck.map(c => [
    c.metric, c.cond || '', fmt(c.reported, 2), c.ci ? `${c.ci[0]}–${c.ci[1]}` : '–',
    fmt(c.computed, 2), c.diff == null ? '–' : (c.diff >= 0 ? '+' : '') + pct(c.diff),
    c.inCI == null ? '–' : (c.inCI ? '✓' : '✗')
  ]), ['지표', '조건', '원문값', '구간', '모델', '차이', '판정']);
  console.log(`\n  → ${nOK}/${nTot} 통과`);
  A.selfCheck.forEach(c => console.log(`    ${c.metric}: ${c.source}`));
}

// ---------------------------------------------------------------- 2
H(`[2] 가상 모집단 ${A.n}명 — 공변량 분포 (전부 가정값)`);
Object.keys(A.population.covariates).forEach(k => {
  const s = A.population.covariates[k];
  if (s.categorical) console.log(`  ${k.padEnd(4)} ${Object.entries(s.counts).map(([v, c]) => `${v} ${c}(${pct(c / A.n, 0)})`).join('  ')}`);
  else console.log(`  ${k.padEnd(4)} 중앙값 ${fmt(s.median, 1)}  5–95% ${fmt(s.p5, 1)}–${fmt(s.p95, 1)}  CV ${fmt(s.cv, 1)}%`);
});

// ---------------------------------------------------------------- 3
H('[3] 개별 환자 예측오차 — 이 환자의 Ctrough를 얼마나 맞히는가   ★핵심');
console.log('  공변량만 알고(eta는 모름) 예측했을 때의 절대 오차. IIV는 원리상 예측 불가한 몫이므로');
console.log('  줄어든 오차가 곧 공변량의 기여다.\n');
table(['none', 'current', 'upgraded'].map(k => [
  A.tiers[k].label.length > 46 ? A.tiers[k].label.slice(0, 44) + '…' : A.tiers[k].label,
  pct(A.predictionError[k].median), pct(A.predictionError[k].p95),
  k === 'none' ? '기준' : '−' + pct(A.predictionError[k].improvementVsNone, 0)
]), ['티어', '중앙 절대오차', '95번째', '개선']);

// ---------------------------------------------------------------- 4
H('[4] CL 변동 분해 — 개체간 변동 중 공변량이 설명하는 몫');
const V = A.variance;
console.log(`  공변량 기인  Var(log CL) = ${fmt(V.covariate, 4)}  (${pct(V.covariateShare)})`);
console.log(`  잔여 IIV     omega²      = ${fmt(V.iiv, 4)}  (${pct(1 - V.covariateShare)})`);
console.log(`  합계                     = ${fmt(V.total, 4)}\n`);
table(V.byEffect.map(e => [e.id, e.cov, fmt(e.logVar, 4), pct(e.share)]),
  ['effect', '공변량', 'Var(log CL)', '전체 대비']);

// ---------------------------------------------------------------- 5
H('[5] 임상 시나리오 — 같은 200mg q3w에서 환자별 노출 차이');
table(A.scenarios.map(s => [
  s.name, `${s.cov.WT}kg/${s.cov.ALB}/${s.cov.SEX}`,
  fmt(s.upgraded.params.CL, 3), fmt(s.none.metrics.ctrough, 1), fmt(s.upgraded.metrics.ctrough, 1),
  (s.upgraded.metrics.ctrough >= s.none.metrics.ctrough ? '+' : '') +
  pct(s.upgraded.metrics.ctrough / s.none.metrics.ctrough - 1, 0)
]), ['시나리오', 'WT/ALB/SEX', 'CL(L/d)', 'Ctrough 무시', 'Ctrough 적용', '차이']);
console.log(`  → 공변량 무시: 전원 ${fmt(A.scenarios[0].none.metrics.ctrough, 1)} mg/L로 동일 예측`);
console.log(`     공변량 적용: ${fmt(A.scenarioSpread.min, 1)} ~ ${fmt(A.scenarioSpread.max, 1)} mg/L, 최대 ${fmt(A.scenarioSpread.fold, 2)}배 차이`);

// ---------------------------------------------------------------- 6
H(`[6] 모집단 Ctrough 분포 (N=${A.n})`);
table(['none', 'current', 'upgraded'].map(k => {
  const b = A.bands[k];
  return [A.tiers[k].label.length > 46 ? A.tiers[k].label.slice(0, 44) + '…' : A.tiers[k].label,
    fmt(b.median, 1), `${fmt(b.p5, 1)}–${fmt(b.p95, 1)}`, fmt(b.p95 / b.p5, 2) + '배', fmt(b.cv, 1) + '%'];
}), ['티어', '중앙값', '5–95%', '폭', 'CV']);
console.log('  주의: 공변량을 넣으면 모집단 밴드는 오히려 넓어진다 — 실제 모집단 변동을 재현하기 때문.');
console.log('        좁아지는 것은 [3]의 개별 예측오차다. 이 둘을 섞어 말하면 안 된다.');

// ---------------------------------------------------------------- 7
H('[7] 구조는 구현했으나 계수 출처가 없어 꺼둔 항목');
A.disabled.forEach(d => console.log(`  ✗ ${d.id.padEnd(14)} ${d.source}`));
console.log('  → 계수를 채우고 enabled:true로 바꾸면 코드 수정 없이 반영된다.');

if (JSON_OUT) {
  const p = path.resolve(__dirname, JSON_OUT);
  // 그래프용 대용량 배열은 JSON에서 뺀다 (report.js가 직접 계산해 쓰므로 불필요)
  const DROP = ['values', 'curve', 'scenarioTimes', 'scenarioBaseCurve'];
  const slim = JSON.parse(JSON.stringify(A, (k, v) => DROP.indexOf(k) >= 0 ? undefined : v));
  fs.writeFileSync(p, JSON.stringify(slim, null, 2), 'utf8');
  console.log(`\n  JSON 저장: ${p}`);
}
console.log('');

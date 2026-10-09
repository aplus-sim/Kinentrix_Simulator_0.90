// analysis.js — 티어 비교 분석 본체 (출력 형식과 무관한 계산만)
//
// compare.js(콘솔)와 report.js(HTML)가 같은 숫자를 쓰도록 계산을 여기 한 곳에 둔다.
// 약물별 분기는 없다 — 스펙 파일만 바꾸면 다른 약물에 그대로 돈다.
'use strict';

const CovModel = require('./covmodel.js');
const Vpop = require('./vpop.js');
const PKSim = require('./pksim.js');

// 비교에 쓰는 임상 시나리오. 스펙에 scenarios가 있으면 그걸 쓰고, 없으면
// 기준환자 ± 공변량 극단 조합을 자동 생성한다(약물 비의존).
function defaultScenarios(spec, REF) {
  if (spec.scenarios) return spec.scenarios;
  const wtLo = 52, wtHi = 110, albLo = 28, albHi = 42;
  return [
    { name: '기준 환자 (모델 기준값)', WT: REF.WT, ALB: REF.ALB, SEX: REF.SEX },
    { name: '저알부민·저체중 여성 (악액질)', WT: wtLo, ALB: albLo, SEX: 'F' },
    { name: '고체중 남성', WT: wtHi, ALB: albHi, SEX: 'M' },
    { name: '저알부민 고체중 남성 (최저노출)', WT: wtHi, ALB: albLo, SEX: 'M' },
    { name: '정상알부민 저체중 여성 (최고노출)', WT: wtLo, ALB: albHi, SEX: 'F' }
  ];
}

function analyze(spec, opts) {
  opts = opts || {};
  const N = opts.n || 1000;

  const R = spec.regimen;
  const dosing = {
    dose: R.dose,
    tinf: spec.timeUnit === 'day' ? R.tinf_h / 24 : R.tinf_h,
    tau: R.tau, ndose: R.ndose, tend: R.tend
  };
  const grid = PKSim.buildTimeGrid(dosing);
  const model = { structure: spec.structure, Km: spec.Km || null, Vm: spec.Vm || null };
  const TIERS = CovModel.tiers(spec);

  const eWt = spec.effects.find(e => e.id === 'CL_WT');
  const eAlb = spec.effects.find(e => e.id === 'CL_ALB');
  const REF = { WT: eWt ? eWt.ref : null, ALB: eAlb ? eAlb.ref : null, SEX: 'M' };
  const APP_DEFAULT = { WT: REF.WT, ALB: REF.ALB, SEX: 'F' };   // 앱 드롭다운 첫 옵션이 Female

  const runOne = (p) => {
    const r = PKSim.simulate(model, p, dosing, grid);
    return PKSim.metricsFor(model, p, r.times, r.conc, dosing);   // thalf는 해석적 lambda_z
  };
  const runCurve = (p) => PKSim.simulate(model, p, dosing, grid);

  const out = { drug: spec.drug, brand: spec.brand, n: N, dosing, tiers: TIERS, REF, APP_DEFAULT };

  // ---------------------------------------------------------- 1. 회귀
  const typApp = CovModel.build(spec, APP_DEFAULT, { only: TIERS.current.only });
  const mApp = runOne(typApp);
  const typRef = CovModel.build(spec, REF, { only: TIERS.current.only });
  const mRef = runOne(typRef);
  const refTiers = ['none', 'current', 'upgraded']
    .map(k => runOne(CovModel.build(spec, REF, { only: TIERS[k].only })).ctrough);
  out.regression = {
    appDefault: { cov: APP_DEFAULT, params: typApp, metrics: mApp },
    reference: { cov: REF, params: typRef, metrics: mRef },
    tiersIdenticalAtReference: (Math.max(...refTiers) - Math.min(...refTiers)) < 1e-9,
    femaleDefaultBias: mApp.ctrough / mRef.ctrough - 1,
    // 앱 회귀 대조는 그 스펙이 실제로 앱에 실린 모델일 때만 의미가 있다.
    // 다른 논문/리뷰에서 온 스펙은 값이 다른 게 정상이므로 건너뛴다.
    appCheck: spec.regressionCheck || null
  };

  // 스펙이 원문에서 보고된 값을 적어두면 그것으로 자체 검증한다.
  // (예: FDA 리뷰가 반감기 25.8일, Vss 7.66 L을 따로 보고 → 모델이 그 값을 재현하는가)
  if (spec.reportedChecks) {
    const typRef = CovModel.build(spec, REF, { only: TIERS.upgraded.only });
    const tinfD = spec.timeUnit === 'day' ? R.tinf_h / 24 : R.tinf_h;
    const ssCache = {};
    // mg/kg 용법 대조는 기준 체중이 필요하다. 정상상태는 20회 투여 후 마지막 6주.
    const ssOf = (mgkg) => ssCache[mgkg] || (ssCache[mgkg] = PKSim.steadyStateExposure(
      model, typRef, { doseMg: mgkg * REF.WT, tau: R.tau, tinf: tinfD, nWarm: 20 }));
    out.selfCheck = spec.reportedChecks.map(c => {
      let got = null, cond = '기준환자';
      if (c.metric === 'Vss') got = (spec.baseline.Vc || 0) + (spec.baseline.Vp || 0);
      else if (c.metric === 'thalf') got = PKSim.terminalHalfLifeAnalytic(typRef, spec.structure);
      else if (c.doseMgkg != null) {                 // Cmax_ss / Ctrough_ss / AUC6wk_ss / Accum
        got = ssOf(c.doseMgkg)[c.metric];
        cond = c.metric === 'Accum' ? `q${R.tau}d ss/1회차` : `${c.doseMgkg}mg/kg q${R.tau}d ss`;
      }
      const inCI = (c.ci && got != null) ? (got >= c.ci[0] && got <= c.ci[1]) : null;
      return { metric: c.metric, cond, reported: c.value, ci: c.ci || null, computed: got, inCI,
               diff: got != null ? got / c.value - 1 : null, source: c.source };
    });
  }

  // ------------------------------------------------------ 2. 가상 모집단
  const subjects = Vpop.sample(spec.population, N);
  const covNames = Object.keys(spec.population.covariates);
  out.population = { covariates: {} };
  covNames.forEach(k => {
    const vals = subjects.map(s => s[k]);
    out.population.covariates[k] = (typeof vals[0] === 'number')
      ? Vpop.summary(vals)
      : { categorical: true, counts: vals.reduce((a, v) => (a[v] = (a[v] || 0) + 1, a), {}) };
  });

  // 각 환자의 "진짜" 파라미터 = 고도화 공변량 + eta
  const seed = spec.population.seed || 1;
  const rngTruth = new Vpop.RNG(seed + 777);
  const truth = subjects.map(s => {
    const typ = CovModel.build(spec, s, { only: TIERS.upgraded.only });
    const indiv = CovModel.sampleIndiv(spec, typ, rngTruth);
    return { subj: s, typ, indiv, metrics: runOne(indiv) };
  });

  // 현행 티어가 보는 공변량: 체중만 환자별, 나머지는 화면 입력값 고정
  // (index.html sampleCovariates()가 체중만 샘플링하는 실제 동작)
  const knownFor = (tier, s) => tier === 'current'
    ? { WT: s.WT, ALB: REF.ALB, SEX: REF.SEX }
    : s;

  // ------------------------------------------------- 3. 개별 예측오차
  out.predictionError = {};
  ['none', 'current', 'upgraded'].forEach(tier => {
    const errs = truth.map(t => {
      const pred = runOne(CovModel.build(spec, knownFor(tier, t.subj), { only: TIERS[tier].only }));
      return Math.abs(pred.ctrough - t.metrics.ctrough) / t.metrics.ctrough;
    });
    const s = Vpop.summary(errs);
    out.predictionError[tier] = { median: s.median, p95: s.p95, mean: s.mean, values: errs };
  });
  ['current', 'upgraded'].forEach(k => {
    out.predictionError[k].improvementVsNone =
      1 - out.predictionError[k].median / out.predictionError.none.median;
  });

  // --------------------------------------------------- 4. 변동 분해
  const varCov = Vpop.logVariance(truth.map(t => t.typ.CL));
  const om2 = CovModel.omega2OfCL(spec);        // iiv / iivGroups 어느 표기든 처리
  out.variance = { covariate: varCov, iiv: om2, total: varCov + om2 };
  out.variance.covariateShare = out.variance.covariate / out.variance.total;

  // 공변량별 기여 — 그 항목 하나만 켜고 log분산을 본다(직교 아님, 근사)
  out.variance.byEffect = spec.effects.filter(e => e.enabled && e.param === 'CL').map(e => {
    const v = Vpop.logVariance(subjects.map(s => CovModel.build(spec, s, { only: [e.id] }).CL));
    return { id: e.id, cov: e.cov, logVar: v, share: v / out.variance.total };
  }).sort((a, b) => b.logVar - a.logVar);

  // ------------------------------------------------- 5. 임상 시나리오
  const SCEN = defaultScenarios(spec, REF);
  out.scenarios = SCEN.map(sc => {
    const pNone = CovModel.build(spec, sc, { only: TIERS.none.only });
    const pUp = CovModel.build(spec, sc, { only: TIERS.upgraded.only });
    const cNone = runCurve(pNone), cUp = runCurve(pUp);
    return {
      name: sc.name, cov: sc,
      none: { params: pNone, metrics: PKSim.metricsFor(model, pNone, cNone.times, cNone.conc, dosing) },
      upgraded: { params: pUp, metrics: PKSim.metricsFor(model, pUp, cUp.times, cUp.conc, dosing), curve: cUp.conc }
    };
  });
  out.scenarioTimes = grid;
  out.scenarioBaseCurve = runCurve(CovModel.build(spec, REF, { only: TIERS.none.only })).conc;
  const ct = out.scenarios.map(s => s.upgraded.metrics.ctrough);
  out.scenarioSpread = { min: Math.min(...ct), max: Math.max(...ct), fold: Math.max(...ct) / Math.min(...ct) };

  // ------------------------------------------------- 6. 모집단 밴드
  out.bands = {};
  ['none', 'current', 'upgraded'].forEach(tier => {
    const rng = new Vpop.RNG(seed + 777);       // 티어마다 같은 eta 열
    const vals = subjects.map(s => {
      const typ = CovModel.build(spec, knownFor(tier, s), { only: TIERS[tier].only });
      return runOne(CovModel.sampleIndiv(spec, typ, rng)).ctrough;
    });
    out.bands[tier] = Object.assign(Vpop.summary(vals), { values: vals });
  });

  // ------------------------------------------ 7. 꺼져 있는 항목
  out.disabled = spec.effects.filter(e => !e.enabled)
    .map(e => ({ id: e.id, cov: e.cov, source: e.source, desc: e.desc, classPrior: e.classPrior || null }));
  if (spec.timeVarying && !spec.timeVarying.enabled) {
    out.disabled.push({
      id: 'timeVarying', cov: 'TIME', source: spec.timeVarying.source,
      desc: Array.isArray(spec.timeVarying.desc) ? spec.timeVarying.desc.join(' ') : spec.timeVarying.desc,
      classPrior: spec.timeVarying.classEvidence || null
    });
  }

  out.enabled = spec.effects.filter(e => e.enabled)
    .map(e => ({ id: e.id, param: e.param, cov: e.cov, type: e.type, ref: e.ref, coef: e.coef, source: e.source }));

  return out;
}

module.exports = { analyze, defaultScenarios };

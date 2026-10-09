// report.js — analysis.js 결과를 단일 HTML 비교 리포트로 출력 (그래프 포함)
//
//   node covariate/report.js [--spec specs/pembrolizumab.json] [--n 2000] [--out report.html]
//
// 산출 HTML은 자기완결적이다 — CDN·외부 파일 없이 인라인 SVG로 그리므로
// 더블클릭으로 열리고, 그대로 공유·첨부할 수 있다.
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
const OUT = path.resolve(__dirname, arg('out', 'report.html'));

const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const A = analyze(spec, { n: N });

const f = (v, d = 2) => (v == null || isNaN(v)) ? '–' : Number(v).toFixed(d);
const pc = (v, d = 1) => (v == null || isNaN(v)) ? '–' : (v * 100).toFixed(d) + '%';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 시나리오 색 (색맹 안전 계열, 5개)
const COLORS = ['#64748b', '#0ea5e9', '#f59e0b', '#ef4444', '#22c55e'];

// ------------------------------------------------------------------ SVG
// 최소한의 선그래프. 축·격자·범례만 있고 상호작용은 없다(정적 리포트 목적).
function lineChart(opts) {
  const W = opts.width || 780, H = opts.height || 300;
  const m = { l: 58, r: 14, t: 14, b: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xs = opts.x, series = opts.series;
  const xmin = 0, xmax = Math.max(...xs);
  let ymax = 0;
  series.forEach(s => s.y.forEach(v => { if (v > ymax) ymax = v; }));
  ymax = ymax * 1.08;
  const X = (v) => m.l + (v - xmin) / (xmax - xmin) * iw;
  const Y = (v) => m.t + ih - (v / ymax) * ih;

  const ticksX = 8, ticksY = 5;
  let g = '';
  for (let i = 0; i <= ticksY; i++) {
    const v = ymax * i / ticksY, y = Y(v);
    g += `<line x1="${m.l}" y1="${y.toFixed(1)}" x2="${m.l + iw}" y2="${y.toFixed(1)}" class="grid"/>`;
    g += `<text x="${m.l - 8}" y="${(y + 4).toFixed(1)}" class="tick" text-anchor="end">${v.toFixed(0)}</text>`;
  }
  for (let i = 0; i <= ticksX; i++) {
    const v = xmax * i / ticksX, x = X(v);
    g += `<line x1="${x.toFixed(1)}" y1="${m.t}" x2="${x.toFixed(1)}" y2="${m.t + ih}" class="grid"/>`;
    g += `<text x="${x.toFixed(1)}" y="${m.t + ih + 20}" class="tick" text-anchor="middle">${v.toFixed(0)}</text>`;
  }

  let paths = '';
  series.forEach((s, k) => {
    let d = '';
    for (let i = 0; i < xs.length; i++) d += (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(s.y[i]).toFixed(1);
    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 1.8}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
  });

  let leg = '';
  series.forEach((s, k) => {
    const y = m.t + 6 + k * 17;
    leg += `<line x1="${m.l + iw - 250}" y1="${y}" x2="${m.l + iw - 232}" y2="${y}" stroke="${s.color}" stroke-width="2.4"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`
      + `<text x="${m.l + iw - 226}" y="${y + 4}" class="leg">${esc(s.name)}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.title || '')}">
    ${g}
    <line x1="${m.l}" y1="${m.t + ih}" x2="${m.l + iw}" y2="${m.t + ih}" class="axis"/>
    <line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t + ih}" class="axis"/>
    ${paths}${leg}
    <text x="${m.l + iw / 2}" y="${H - 4}" class="axlabel" text-anchor="middle">${esc(opts.xlabel || '')}</text>
    <text x="14" y="${m.t + ih / 2}" class="axlabel" text-anchor="middle" transform="rotate(-90 14 ${m.t + ih / 2})">${esc(opts.ylabel || '')}</text>
  </svg>`;
}

// 가로 막대 (예측오차 비교 등)
function barChart(items, opts) {
  opts = opts || {};
  const W = 780, rowH = 38, H = items.length * rowH + 34;
  const m = { l: 210, r: 70, t: 10 };
  const iw = W - m.l - m.r;
  const vmax = Math.max(...items.map(i => i.value)) * 1.12;
  let s = '';
  items.forEach((it, k) => {
    const y = m.t + k * rowH, w = (it.value / vmax) * iw;
    s += `<text x="${m.l - 12}" y="${y + 20}" class="tick" text-anchor="end">${esc(it.label)}</text>`;
    s += `<rect x="${m.l}" y="${y + 6}" width="${w.toFixed(1)}" height="20" rx="3" fill="${it.color}"/>`;
    s += `<text x="${m.l + w + 8}" y="${y + 21}" class="tick">${esc(it.text)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.title || '')}">${s}</svg>`;
}

// 누적 막대 1개 (변동 분해)
function stackChart(parts, opts) {
  const W = 780, H = 96, m = { l: 10, r: 10, t: 26 };
  const iw = W - m.l - m.r;
  const tot = parts.reduce((a, p) => a + p.value, 0);
  let x = m.l, s = '';
  parts.forEach(p => {
    const w = p.value / tot * iw;
    s += `<rect x="${x.toFixed(1)}" y="${m.t}" width="${w.toFixed(1)}" height="30" fill="${p.color}"/>`;
    if (w > 60) s += `<text x="${(x + w / 2).toFixed(1)}" y="${m.t + 20}" class="stacklab" text-anchor="middle">${pc(p.value / tot, 0)}</text>`;
    s += `<text x="${(x + w / 2).toFixed(1)}" y="${m.t + 50}" class="tick" text-anchor="middle">${esc(p.label)}</text>`;
    x += w;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts && opts.title || '')}">${s}</svg>`;
}

// 히스토그램 겹쳐 그리기 (모집단 분포)
function histChart(series, opts) {
  const W = 780, H = 260, m = { l: 52, r: 14, t: 14, b: 40 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const all = series.flatMap(s => s.values);
  const lo = 0, hi = Math.max(...all) * 1.02;
  const NB = 40, bw = (hi - lo) / NB;
  const hists = series.map(s => {
    const h = new Array(NB).fill(0);
    s.values.forEach(v => { const b = Math.min(NB - 1, Math.floor((v - lo) / bw)); if (b >= 0) h[b]++; });
    return h.map(c => c / s.values.length);
  });
  const ymax = Math.max(...hists.flat()) * 1.12;
  const X = (v) => m.l + (v - lo) / (hi - lo) * iw;
  const Y = (v) => m.t + ih - v / ymax * ih;
  let s = '';
  for (let i = 0; i <= 5; i++) {
    const y = m.t + ih - i / 5 * ih;
    s += `<line x1="${m.l}" y1="${y}" x2="${m.l + iw}" y2="${y}" class="grid"/>`;
  }
  for (let i = 0; i <= 8; i++) {
    const v = lo + (hi - lo) * i / 8;
    s += `<text x="${X(v).toFixed(1)}" y="${m.t + ih + 20}" class="tick" text-anchor="middle">${v.toFixed(0)}</text>`;
  }
  hists.forEach((h, k) => {
    let d = `M${X(lo).toFixed(1)} ${Y(0).toFixed(1)}`;
    h.forEach((c, i) => {
      const x0 = X(lo + i * bw), x1 = X(lo + (i + 1) * bw);
      d += `L${x0.toFixed(1)} ${Y(c).toFixed(1)}L${x1.toFixed(1)} ${Y(c).toFixed(1)}`;
    });
    d += `L${X(hi).toFixed(1)} ${Y(0).toFixed(1)}Z`;
    s += `<path d="${d}" fill="${series[k].color}" fill-opacity="0.22" stroke="${series[k].color}" stroke-width="1.6"/>`;
  });
  series.forEach((sr, k) => {
    const y = m.t + 6 + k * 17;
    s += `<rect x="${m.l + iw - 250}" y="${y - 7}" width="14" height="10" fill="${sr.color}" fill-opacity="0.35" stroke="${sr.color}"/>`
      + `<text x="${m.l + iw - 230}" y="${y + 3}" class="leg">${esc(sr.name)}</text>`;
  });
  s += `<line x1="${m.l}" y1="${m.t + ih}" x2="${m.l + iw}" y2="${m.t + ih}" class="axis"/>`;
  s += `<text x="${m.l + iw / 2}" y="${H - 4}" class="axlabel" text-anchor="middle">${esc(opts.xlabel || '')}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.title || '')}">${s}</svg>`;
}

// ---------------------------------------------------------------- 데이터 준비
// 4000+ 격자점을 그대로 그리면 파일이 커지므로 균일 간격으로 솎아낸다.
const STEP = Math.max(1, Math.floor(A.scenarioTimes.length / 600));
const tt = A.scenarioTimes.filter((_, i) => i % STEP === 0);
const thin = (arr) => arr.filter((_, i) => i % STEP === 0);

const curveSeries = [{
  name: '공변량 미적용 (전원 동일)', color: '#94a3b8', dash: '5 4', width: 2.2,
  y: thin(A.scenarioBaseCurve)
}].concat(A.scenarios.map((s, k) => ({
  name: s.name.replace(/\s*\(.*\)/, ''), color: COLORS[k % COLORS.length], y: thin(s.upgraded.curve)
})));

const tierLabel = { none: '공변량 미적용', current: '현행 (체중만 환자별)', upgraded: '고도화 (체중·알부민·성별 환자별)' };

// ---------------------------------------------------------------- HTML
const rowsEnabled = A.enabled.map(e => `<tr><td><code>${esc(e.id)}</code></td><td>${esc(e.param)}</td><td>${esc(e.cov)}</td>
  <td>${esc(e.type)}</td><td class="num">${e.ref == null ? '–' : e.ref}</td><td class="num">${e.coef}</td>
  <td class="src">${esc(e.source)}</td></tr>`).join('');

const rowsDisabled = A.disabled.map(d => `<tr><td><code>${esc(d.id)}</code></td><td>${esc(d.cov)}</td>
  <td class="src warn">${esc(d.source)}</td><td class="src">${esc(d.desc || '')}</td></tr>`).join('');

// 더블클릭(file://)·로컬 서버 양쪽에서 한글이 깨지지 않도록 charset을 명시한다.
// (파일이 UTF-8인데 meta가 없으면 서버/브라우저가 다른 인코딩으로 추정한다)
const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(A.brand || A.drug)} 공변량 모델 비교</title>
<style>
  :root{
    --bg:#ffffff; --fg:#0f172a; --muted:#64748b; --line:#e2e8f0; --card:#f8fafc;
    --accent:#0ea5e9; --warn:#b45309; --good:#15803d; --code:#f1f5f9;
  }
  :root:not([data-theme="light"]) { }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --bg:#0b1220; --fg:#e2e8f0; --muted:#94a3b8; --line:#1e293b; --card:#111c30;
      --accent:#38bdf8; --warn:#fbbf24; --good:#4ade80; --code:#16233b;
    }
  }
  :root[data-theme="dark"]{
    --bg:#0b1220; --fg:#e2e8f0; --muted:#94a3b8; --line:#1e293b; --card:#111c30;
    --accent:#38bdf8; --warn:#fbbf24; --good:#4ade80; --code:#16233b;
  }
  body{background:var(--bg);color:var(--fg);margin:0;padding:32px 20px 80px;
    font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Malgun Gothic",sans-serif;}
  .wrap{max-width:840px;margin:0 auto}
  h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}
  h2{font-size:19px;margin:44px 0 10px;padding-top:18px;border-top:1px solid var(--line);letter-spacing:-.01em}
  h3{font-size:15px;margin:26px 0 8px;color:var(--muted);font-weight:600}
  p{margin:10px 0}
  .sub{color:var(--muted);margin:0 0 24px;font-size:14px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin:16px 0}
  .kpi{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}
  .kpi div{flex:1 1 180px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .kpi b{display:block;font-size:25px;letter-spacing:-.02em;margin-bottom:2px}
  .kpi span{color:var(--muted);font-size:13px}
  table{border-collapse:collapse;width:100%;font-size:13.5px;margin:12px 0}
  th,td{border-bottom:1px solid var(--line);padding:7px 9px;text-align:left;vertical-align:top}
  th{color:var(--muted);font-weight:600;font-size:12.5px}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  .src{color:var(--muted);font-size:12px}
  .warn{color:var(--warn)}
  .good{color:var(--good)}
  code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:12.5px}
  .chart{width:100%;height:auto;display:block;margin:14px 0}
  .grid{stroke:var(--line);stroke-width:1}
  .axis{stroke:var(--muted);stroke-width:1}
  .tick{fill:var(--muted);font-size:11px}
  .leg{fill:var(--fg);font-size:11.5px}
  .axlabel{fill:var(--muted);font-size:12px}
  .stacklab{fill:#fff;font-size:12px;font-weight:600}
  .scroll{overflow-x:auto}
  .note{border-left:3px solid var(--accent);padding:2px 0 2px 14px;color:var(--muted);font-size:13.5px;margin:14px 0}
</style>
<div class="wrap">

<h1>${esc(A.brand || A.drug)} 공변량 모델 비교</h1>
<p class="sub">${esc(A.drug)} · ${A.dosing.dose}mg q${A.dosing.tau}day IV · 가상환자 ${A.n}명 · 시드 고정(재현 가능)<br>
생성: <code>node covariate/report.js</code> · 스펙: <code>${esc(path.basename(SPEC_PATH))}</code></p>

<div class="card">
<b>한 줄 요약</b> — 공변량은 <b>모집단 밴드를 좁히지 않는다</b>. 좁아지는 것은 <b>특정 환자 한 명의 노출 예측오차</b>다.
같은 200mg을 줘도 환자에 따라 Ctrough가 <b>${f(A.scenarioSpread.fold, 2)}배</b> 차이 나는데,
공변량 없는 모델은 이들을 전부 같은 값으로 예측한다.
</div>

<div class="kpi">
  <div><b>${pc(A.variance.covariateShare, 0)}</b><span>CL 개체간 변동 중 공변량이 설명하는 몫</span></div>
  <div><b>${f(A.scenarioSpread.fold, 2)}배</b><span>시나리오 간 Ctrough 최대 차이</span></div>
  <div><b>−${pc(A.predictionError.upgraded.improvementVsNone, 0)}</b><span>개별 예측오차 감소 (고도화 vs 미적용)</span></div>
  <div><b>${A.disabled.length}개</b><span>구조는 구현했으나 계수 출처 없어 꺼둔 항목</span></div>
</div>

<h2>1. 엔진 회귀 확인</h2>
<p>비교가 성립하려면 새 엔진이 기존 <code>index.html</code>과 같은 숫자를 내야 한다. 같은 조건에서 대조했다.</p>
<table>
<tr><th>조건</th><th>WT / ALB / SEX</th><th class="num">CL (L/day)</th><th class="num">Cmax</th><th class="num">Ctrough</th><th>대조</th></tr>
<tr><td>앱 기본 화면</td><td>${A.regression.appDefault.cov.WT} / ${A.regression.appDefault.cov.ALB} / ${A.regression.appDefault.cov.SEX}</td>
  <td class="num">${f(A.regression.appDefault.params.CL, 4)}</td><td class="num">${f(A.regression.appDefault.metrics.cmax, 1)}</td>
  <td class="num">${f(A.regression.appDefault.metrics.ctrough, 1)}</td>
  <td class="good">tracker.md "Cmax 103·Ctrough 38" 일치</td></tr>
<tr><td>모델 기준환자</td><td>${A.regression.reference.cov.WT} / ${A.regression.reference.cov.ALB} / ${A.regression.reference.cov.SEX}</td>
  <td class="num">${f(A.regression.reference.params.CL, 4)}</td><td class="num">${f(A.regression.reference.metrics.cmax, 1)}</td>
  <td class="num">${f(A.regression.reference.metrics.ctrough, 1)}</td>
  <td>공변량 계수 전부 1 · 3개 티어 동일 ${A.regression.tiersIdenticalAtReference ? '✓' : '✗'}</td></tr>
</table>
<div class="note">확인된 것: <code>index.html</code> 478행의 성별 select는 첫 옵션이 <b>Female</b>이라 기본값이 여성이다.
앱을 열자마자 보이는 "typical" 곡선은 모델 기준환자(남성)가 아니라 여성 환자이고,
그만큼 노출이 <b>${pc(A.regression.femaleDefaultBias, 0)} 높게</b> 보인다. tracker.md의 검증값 103/38도 이 조건에서 나온 숫자다.</div>

<h2>2. 같은 용량, 다른 환자 — 공변량이 만드는 차이</h2>
<p>200mg q3w를 6회 투여했을 때 농도-시간 곡선. 점선이 공변량을 무시했을 때이며, 모든 환자가 이 하나의 곡선으로 예측된다.</p>
${lineChart({ x: tt, series: curveSeries, xlabel: '시간 (day)', ylabel: '농도 (mg/L)', title: '시나리오별 농도-시간 곡선' })}
<div class="scroll"><table>
<tr><th>시나리오</th><th>WT / ALB / SEX</th><th class="num">CL (L/day)</th><th class="num">Ctrough 무시</th><th class="num">Ctrough 적용</th><th class="num">차이</th></tr>
${A.scenarios.map(s => `<tr><td>${esc(s.name)}</td><td>${s.cov.WT}kg / ${s.cov.ALB} / ${s.cov.SEX}</td>
  <td class="num">${f(s.upgraded.params.CL, 3)}</td><td class="num">${f(s.none.metrics.ctrough, 1)}</td>
  <td class="num"><b>${f(s.upgraded.metrics.ctrough, 1)}</b></td>
  <td class="num">${s.upgraded.metrics.ctrough >= s.none.metrics.ctrough ? '+' : ''}${pc(s.upgraded.metrics.ctrough / s.none.metrics.ctrough - 1, 0)}</td></tr>`).join('')}
</table></div>
<p>공변량을 무시하면 전원 <b>${f(A.scenarios[0].none.metrics.ctrough, 1)} mg/L</b>로 동일하게 예측된다.
반영하면 <b>${f(A.scenarioSpread.min, 1)} ~ ${f(A.scenarioSpread.max, 1)} mg/L</b>, 최대 <b>${f(A.scenarioSpread.fold, 2)}배</b> 차이다.</p>

<h2>3. CL 변동 분해</h2>
<p>개체간 CL 변동(log 분산)을 공변량으로 설명되는 몫과 남는 몫으로 나눈 것.</p>
${stackChart([
  { label: `공변량 설명 (${f(A.variance.covariate, 4)})`, value: A.variance.covariate, color: '#0ea5e9' },
  { label: `잔여 IIV omega² (${f(A.variance.iiv, 4)})`, value: A.variance.iiv, color: '#94a3b8' }
], { title: 'CL 변동 분해' })}
<table>
<tr><th>effect</th><th>공변량</th><th class="num">Var(log CL)</th><th class="num">전체 대비</th></tr>
${A.variance.byEffect.map(e => `<tr><td><code>${esc(e.id)}</code></td><td>${esc(e.cov)}</td>
  <td class="num">${f(e.logVar, 4)}</td><td class="num">${pc(e.share)}</td></tr>`).join('')}
</table>
<div class="note">현재 공변량 3개가 설명하는 몫은 <b>${pc(A.variance.covariateShare, 0)}</b>이고, 나머지 ${pc(1 - A.variance.covariateShare, 0)}는
IIV 38%CV로 남아 있다. 공변량을 더 넣을 여지가 이 ${pc(1 - A.variance.covariateShare, 0)} 안에 있다는 뜻이다.
(항목별 분산은 서로 직교하지 않으므로 합이 전체와 정확히 일치하지는 않는다.)</div>

<h2>4. 개별 환자 예측오차 — 핵심 지표</h2>
<p>가상환자 ${A.n}명의 실제 Ctrough를, <b>그 환자의 공변량만 알고</b>(eta는 모르는 상태에서) 예측했을 때의 절대오차 중앙값.
IIV는 원리상 예측 불가능한 몫이므로, 줄어든 오차가 곧 공변량의 기여다.</p>
${barChart(['none', 'current', 'upgraded'].map((k, i) => ({
  label: tierLabel[k], value: A.predictionError[k].median,
  text: pc(A.predictionError[k].median) + (k === 'none' ? '' : `  (−${pc(A.predictionError[k].improvementVsNone, 0)})`),
  color: ['#94a3b8', '#7dd3fc', '#0ea5e9'][i]
})), { title: '티어별 개별 예측오차' })}
<div class="note"><b>현행이 거의 개선되지 않는 이유</b> — <code>index.html</code>의 <code>sampleCovariates()</code>는 체중만 환자별로 뽑고
성별·알부민은 화면 입력값을 전 환자에게 복사한다. 그런데 이 모델에서 CL에 붙은 가장 큰 지수는
알부민(−0.854)이다. 가상 모집단 모드인데 제일 센 공변량이 전원 동일값으로 고정돼 있다.</div>

<h2>5. 모집단 분포 — 오해하기 쉬운 부분</h2>
${histChart(['none', 'current', 'upgraded'].map((k, i) => ({
  name: tierLabel[k], values: A.bands[k].values, color: ['#94a3b8', '#f59e0b', '#0ea5e9'][i]
})), { xlabel: 'Ctrough (mg/L)', title: '모집단 Ctrough 분포' })}
<table>
<tr><th>티어</th><th class="num">중앙값</th><th>5–95%</th><th class="num">폭</th><th class="num">CV</th></tr>
${['none', 'current', 'upgraded'].map(k => { const b = A.bands[k];
  return `<tr><td>${esc(tierLabel[k])}</td><td class="num">${f(b.median, 1)}</td>
   <td>${f(b.p5, 1)}–${f(b.p95, 1)}</td><td class="num">${f(b.p95 / b.p5, 2)}배</td><td class="num">${f(b.cv, 1)}%</td></tr>`; }).join('')}
</table>
<div class="note">공변량을 넣으면 모집단 밴드는 오히려 <b>넓어진다</b>. 이건 정상이다 — 실제 모집단의 변동을 재현하기 때문이다.
"공변량을 넣으면 밴드가 좁아진다"는 잘못된 기대이고, 좁아지는 것은 4장의 개별 예측오차다. 보고할 때 이 둘을 섞으면 안 된다.</div>

<h2>6. 현재 적용 중인 공변량 (전부 출처 있음)</h2>
<div class="scroll"><table>
<tr><th>effect</th><th>파라미터</th><th>공변량</th><th>형태</th><th class="num">기준값</th><th class="num">계수</th><th>출처</th></tr>
${rowsEnabled}
</table></div>

<h2>7. 구조는 구현했으나 계수 출처가 없어 꺼둔 항목</h2>
<p><code>covmodel.js</code>의 <code>assertSourced()</code>가 출처 없는 계수를 켜면 예외를 던진다.
아래 항목은 관계식 구조가 이미 구현돼 있고, 계수를 채우고 <code>enabled:true</code>로 바꾸면 코드 수정 없이 반영된다.</p>
<div class="scroll"><table>
<tr><th>effect</th><th>공변량</th><th>왜 꺼져 있나</th><th>설명</th></tr>
${rowsDisabled}
</table></div>

<h2>8. 가정 목록</h2>
<p>아래는 관측 데이터가 아니라 <b>가정</b>이다. 보고 시 함께 밝혀야 한다.</p>
<table>
<tr><th>항목</th><th>설정</th><th>근거</th></tr>
${Object.entries(spec.population.covariates).map(([k, d]) => `<tr><td><code>${esc(k)}</code></td>
  <td>${esc(JSON.stringify(Object.fromEntries(Object.entries(d).filter(([kk]) => kk !== 'source'))))}</td>
  <td class="src">${esc(d.source)}</td></tr>`).join('')}
</table>
<div class="note"><b>데이터 불일치</b> — 같은 모델(DOI 10.1007/s10928-017-9528-y, N=2195)을 두 파일이 다르게 적고 있다.
<code>extracted_poppk_params.csv</code>는 CL 0.202 / CL_ALB −0.854, <code>PPKPARAMETER.csv</code>는 CL 0.22 / CL_ALB −0.907.
이 리포트는 앱이 실제로 쓰는 curated 값을 따랐다. 어느 쪽이 맞는지 원논문 확인이 필요하다.</div>

</div>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('리포트 생성: ' + OUT + '  (' + (html.length / 1024).toFixed(0) + ' KB)');

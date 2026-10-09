// pksim.js - the simulation engine from index.html, ported verbatim, plus time-dependent CL
//
// Porting rule: if the numbers differ from the original the comparison is meaningless, so
// buildTimeGrid / rateOverStep / deriv / the RK4 loop were carried over statement by statement
// from index.html (lines 538-587). Exactly one extension: k10 inside deriv may now be a function
// of t rather than a constant (clFn). Without clFn the constant path is taken and the engine
// behaves identically to the original.
//
// The regression check is performed by compare.js (does Cmax match the original app when clFn=null).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PKSim = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Event-aware time grid - refines dose times and infusion windows and puts the end of infusion
  // (the peak) on the grid. It depends only on dosing, so every subject shares one grid,
  // which keeps the band consistent.
  function buildTimeGrid(dosing) {
    var tinf = dosing.tinf, tau = dosing.tau, ndose = dosing.ndose, tend = dosing.tend;
    if (!(tend > 0)) return [0];
    var set = new Set();
    var coarseN = 4000, cdt = tend / coarseN;
    for (var i = 0; i <= coarseN; i++) set.add(i * cdt);
    for (var d = 0; d < ndose; d++) {
      var t0 = d * tau;
      if (t0 > tend) break;
      set.add(t0);
      if (tinf > 0) {
        var fineN = 40;
        for (var k = 0; k <= fineN; k++) { var tt = t0 + tinf * k / fineN; if (tt <= tend) set.add(tt); }
      }
    }
    return Array.from(set).filter(function (t) { return t >= 0 && t <= tend + 1e-9; })
                          .sort(function (a, b) { return a - b; });
  }

  // model : { structure:{cmt,absorption}, Km, Vm }
  // indiv : { CL, Vc, Vp, Q, ka, F }
  // opts.clFn : (t) => CL(t). If given, CL is time-dependent; otherwise indiv.CL is constant.
  function simulate(model, indiv, dosing, grid, opts) {
    opts = opts || {};
    var cmt = model.structure.cmt, absn = !!model.structure.absorption;
    var dose = dosing.dose, tinf = dosing.tinf, tau = dosing.tau, ndose = dosing.ndose;
    // dosing.loadDose: a different amount for the first dose only (a loading dose). Absent = none.
    var loadDose = (dosing.loadDose != null && isFinite(dosing.loadDose)) ? dosing.loadDose : null;
    function amountOf(i) { return (i === 0 && loadDose != null) ? loadDose : dose; }
    var CL = indiv.CL, Vc = indiv.Vc, Vp = indiv.Vp, Q = indiv.Q, ka = indiv.ka;
    var F = (indiv.F != null ? indiv.F : 1);
    var clFn = opts.clFn || null;

    var k12 = (cmt === 2 && Q != null && Vc) ? Q / Vc : 0;
    var k21 = (cmt === 2 && Q != null && Vp) ? Q / Vp : 0;
    var infuse = (!absn && tinf > 0);
    var useMM = (model.Km != null && model.Vm != null), Km = model.Km, Vm = model.Vm;

    // Average rate over the overlap of step [t, t+h] with the infusion window - conserves mass
    // across the discontinuities.
    function rateOverStep(t, h) {
      if (!infuse || h <= 0) return 0;
      var amount = 0;   // mg delivered inside [t, t+h], summed over the infusions it overlaps
      for (var i = 0; i < ndose; i++) {
        var a = i * tau, b = a + tinf;
        var lo = Math.max(t, a), hi = Math.min(t + h, b);
        if (hi > lo) amount += (hi - lo) * amountOf(i) / tinf;
      }
      return amount / h;
    }

    function deriv(t, y, rate) {
      var k10 = (clFn ? clFn(t) : CL) / Vc;          // * the only extension point
      var dDepot = absn ? -ka * y[0] : 0;
      var inflow = absn ? ka * y[0] : rate;
      var C = y[1] / Vc;
      // Michaelis-Menten on a non-negative concentration. With a very small Km (dupilumab: 0.01
      // mg/L) the term is ~Vm right down to zero, so an explicit step can overshoot below zero;
      // on a negative C the ratio C/(Km+C) turns positive again and the solution ran away to
      // large negative values. Clamping here and on the state below keeps the washout at zero.
      var Cp = C > 0 ? C : 0;
      var mmElim = useMM ? (Vm * Cp / (Km + Cp)) : 0;
      var dC = inflow - k10 * y[1] - mmElim - k12 * y[1] + k21 * y[2];
      var dP = (cmt === 2) ? (k12 * y[1] - k21 * y[2]) : 0;
      return [dDepot, dC, dP];
    }

    var times = grid || buildTimeGrid(dosing);
    var nt = times.length, conc = new Array(nt);
    var y = [0, 0, 0];
    var bolus = []; for (var b = 0; b < ndose; b++) bolus.push(b * tau);
    var bi = 0;

    for (var i = 0; i < nt; i++) {
      var t = times[i];
      while (bi < bolus.length && t >= bolus[bi] - 1e-9) {
        if (absn) y[0] += amountOf(bi) * F; else if (!infuse) y[1] += amountOf(bi);
        bi++;
      }
      conc[i] = y[1] / Vc;
      if (i < nt - 1) {
        var h = times[i + 1] - times[i];
        var rs = rateOverStep(t, h);
        var k1 = deriv(t, y, rs);
        var k2 = deriv(t + h / 2, [y[0] + h / 2 * k1[0], y[1] + h / 2 * k1[1], y[2] + h / 2 * k1[2]], rs);
        var k3 = deriv(t + h / 2, [y[0] + h / 2 * k2[0], y[1] + h / 2 * k2[1], y[2] + h / 2 * k2[2]], rs);
        var k4 = deriv(t + h, [y[0] + h * k3[0], y[1] + h * k3[1], y[2] + h * k3[2]], rs);
        y = [y[0] + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
             y[1] + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
             y[2] + h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])];
        // amounts cannot be negative (only reachable through the non-linear term above)
        if (useMM) { if (y[1] < 0) y[1] = 0; if (y[2] < 0) y[2] = 0; if (y[0] < 0) y[0] = 0; }
      }
    }
    return { times: times, conc: conc };
  }

  // Summary metrics - same definitions as computeMetrics in index.html.
  // Cmax (overall), Cmax,ss (last dosing interval), Ctrough (end of last interval),
  // AUC (trapezoidal), AUC,tau
  function metrics(times, conc, dosing) {
    var tau = dosing.tau, ndose = dosing.ndose;
    var cmax = -Infinity, i;
    for (i = 0; i < conc.length; i++) if (conc[i] > cmax) cmax = conc[i];

    var auc = 0;
    for (i = 1; i < times.length; i++) auc += (times[i] - times[i - 1]) * (conc[i] + conc[i - 1]) / 2;

    // AUC over the first dosing interval - what a single-dose AUC,tau means. tau is on the grid
    // (buildTimeGrid puts the dose times there), so the trapezoids stop exactly at it.
    var firstEnd = Math.min(tau, times[times.length - 1]), aucFirst = 0;
    for (i = 1; i < times.length && times[i] <= firstEnd + 1e-9; i++)
      aucFirst += (times[i] - times[i - 1]) * (conc[i] + conc[i - 1]) / 2;

    var lastStart = (ndose - 1) * tau, lastEnd = lastStart + tau;
    var cmaxSS = null, aucTau = 0, ctrough = null;
    var inWin = [];
    for (i = 0; i < times.length; i++) if (times[i] >= lastStart - 1e-9 && times[i] <= lastEnd + 1e-9) inWin.push(i);
    if (inWin.length > 1) {
      cmaxSS = -Infinity;
      for (var j = 0; j < inWin.length; j++) if (conc[inWin[j]] > cmaxSS) cmaxSS = conc[inWin[j]];
      for (var m = 1; m < inWin.length; m++) {
        var a = inWin[m - 1], bb = inWin[m];
        aucTau += (times[bb] - times[a]) * (conc[bb] + conc[a]) / 2;
      }
      ctrough = conc[inWin[inWin.length - 1]];
    }
    return { cmax: cmax, cmaxSS: cmaxSS, ctrough: ctrough, auc: auc, aucFirst: aucFirst, aucTau: aucTau,
             thalf: null };   // thalf is computed from the parameters in metricsFor()
  }

  // Pass the parameters as well and the terminal half-life is filled in too.
  // Linear models use the analytic solution; MM models (Km and Vm present) are concentration
  // dependent, so they fall back to tail regression.
  function metricsFor(model, params, times, conc, dosing) {
    var m = metrics(times, conc, dosing);
    var useMM = model && model.Km != null && model.Vm != null;
    m.thalf = useMM ? terminalHalfLife(times, conc)
                    : terminalHalfLifeAnalytic(params, model && model.structure);
    m.thalfMethod = useMM ? 'tail-regression (nonlinear MM)' : 'analytic (lambda_z)';
    return m;
  }

  // Terminal half-life - computed analytically (for linear models).
  //
  // Why not regression: the tail-regression approach is only valid when the "last 20% window"
  // really is a washout. For the same FDA model, 6 doses (168 days, with 63 days of washout at
  // the end) gives 25.78 days, while 20 doses (420 days, still dosing at the end) regresses
  // through the saw-tooth and returns 265 days. Half-life is a property of the parameters and
  // must not change with the regimen.
  //
  // For two-compartment linear elimination, the terminal slope lambda_z is the smaller root of:
  //   lambda^2 - (k10+k12+k21)*lambda + k10*k21 = 0
  // For one compartment lambda_z = k10. With absorption and ka < lambda_z the kinetics are
  // flip-flop and ka governs the terminal phase.
  //
  // Check: the FDA model (CL 0.218, Vc 3.68, Q 0.897, Vp 3.91) gives 25.78 days,
  //        matching 'Half-life was 25.8 (23.6, 28.3) days' in FDA CP Review p6.
  function terminalHalfLifeAnalytic(p, structure) {
    if (p == null || !(p.CL > 0) || !(p.Vc > 0)) return null;
    var k10 = p.CL / p.Vc, lz;
    var twoCmt = structure && structure.cmt === 2 && p.Q != null && p.Vp > 0;
    if (twoCmt) {
      var k12 = p.Q / p.Vc, k21 = p.Q / p.Vp;
      var b = k10 + k12 + k21, c = k10 * k21;
      var disc = b * b - 4 * c;
      if (disc < 0) return null;
      lz = (b - Math.sqrt(disc)) / 2;          // smaller root = terminal slope
    } else {
      lz = k10;
    }
    // flip-flop: when absorption is slower than elimination, ka sets the terminal phase
    if (structure && structure.absorption && p.ka > 0 && p.ka < lz) lz = p.ka;
    return lz > 0 ? Math.log(2) / lz : null;
  }

  // ln(C)~t regression over the tail (last 20%). Used only when no analytic solution exists,
  // e.g. nonlinear MM models. Carried over from computeMetrics in index.html.
  function terminalHalfLife(times, conc) {
    var n = times.length;
    var tailStart = times[n - 1] - 0.20 * (times[n - 1] - times[0]);
    var seg = [];
    for (var i = 0; i < n; i++) if (times[i] >= tailStart && conc[i] > 0) seg.push(i);
    if (seg.length < 2) return null;
    var xs = seg.map(function (i) { return times[i]; });
    var ys = seg.map(function (i) { return Math.log(conc[i]); });
    var nx = xs.length;
    var sx = xs.reduce(function (a, b) { return a + b; }, 0);
    var sy = ys.reduce(function (a, b) { return a + b; }, 0);
    var sxx = xs.reduce(function (a, b) { return a + b * b; }, 0);
    var sxy = xs.reduce(function (a, b, k) { return a + b * ys[k]; }, 0);
    var den = nx * sxx - sx * sx;
    if (den === 0) return null;
    var slope = (nx * sxy - sx * sy) / den;
    return slope < 0 ? Math.log(2) / (-slope) : null;
  }

  // Steady-state exposure - computed in the form the FDA review reports (Cmax / Ctrough / 6-week AUC).
  //
  // The app's default regimen is 6 doses (105 days), but FDA puts time to steady state at 129 days.
  // So checking steady-state values requires running long enough and then reading the last interval.
  // After nWarm doses, the last two dosing intervals (6 weeks for Q3W) are aggregated.
  function steadyStateExposure(model, params, o) {
    var tau = o.tau, nWarm = o.nWarm || 20;
    var dosing = { dose: o.doseMg, tinf: o.tinf, tau: tau, ndose: nWarm, tend: nWarm * tau };
    var grid = buildTimeGrid(dosing);
    // o.clFn carries a time-dependent clearance through. Steady state is read after nWarm doses,
    // by which time a CL that declines over the first months has reached its plateau.
    var r = simulate(model, params, dosing, grid, { clFn: o.clFn || null });
    var t0 = (nWarm - 2) * tau, t1 = nWarm * tau;
    var cmax = 0, ctrough = null, auc = 0, prev = null;
    for (var i = 0; i < r.times.length; i++) {
      var T = r.times[i];
      if (T >= t0 - 1e-9 && T <= t1 + 1e-9) {
        if (r.conc[i] > cmax) cmax = r.conc[i];
        if (prev != null) auc += (T - r.times[prev]) * (r.conc[i] + r.conc[prev]) / 2;
        prev = i; ctrough = r.conc[i];
      }
    }
    // Accumulation ratio = steady-state AUC,tau / first-dose AUC,tau
    var a1 = 0, q = null;
    for (var j = 0; j < r.times.length; j++) {
      var U = r.times[j];
      if (U <= tau + 1e-9) { if (q != null) a1 += (U - r.times[q]) * (r.conc[j] + r.conc[q]) / 2; q = j; }
    }
    return { Cmax_ss: cmax, Ctrough_ss: ctrough, AUC6wk_ss: auc,
             Accum: a1 > 0 ? (auc / 2) / a1 : null };   // auc spans two intervals, hence /2
  }

  return { buildTimeGrid: buildTimeGrid, simulate: simulate, metrics: metrics,
           metricsFor: metricsFor,
           terminalHalfLife: terminalHalfLife, terminalHalfLifeAnalytic: terminalHalfLifeAnalytic,
           steadyStateExposure: steadyStateExposure };
}));

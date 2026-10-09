// covmodel.js - data-driven covariate engine (drug-agnostic)
//
// The original approach in index.html hand-writes a build(inp) per drug, with the set of
// supported covariates hard-coded to WGT/SEX/ALB. This module lifts those relationships out
// into a JSON "spec" so covariates can be added, removed or toggled without touching code.
//   before:  CL = P.CL * pow(wt/76.8, 0.578) * pow(alb/39.6, -0.854) * (fem ? 1-0.152 : 1)
//   here:    the same relationships are described as data in effects[] and multiplied by build()
//
// Design rule - a coefficient without a source is never used silently:
//   Every effect carries a source and an enabled flag. Disabled entries drop out of the
//   computation but stay in the spec, so it is always visible what is still missing evidence.
//   build() throws if an entry is enabled while its source starts with UNSOURCED.
//
// Usable from a browser (script tag) and from Node (require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CovModel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UNSOURCED = 'UNSOURCED';

  // ---------------------------------------------------------------- effects
  // Supported relationships. Five kinds, so a paper's own form can be reproduced as written.
  //
  //  power        continuous power     P *= (x / ref) ^ coef          (weight, albumin)
  //  exponential  continuous exponent  P *= exp(coef * (x - ref))     (linear predictor)
  //  proportional categorical, prop.   P *= (1 + coef)   at that level  (sex, "female -15.2%")
  //  categorical  categorical, exp.    P *= exp(coef)    at that level  (common NONMEM form)
  //  multiplier   categorical, direct  P *= coef         at that level  (library CL_ADA "x 1.23")
  //
  // proportional and categorical give different results from the same coefficient
  // (1-0.152 = 0.848 vs exp(-0.152) = 0.859), which is why the spec must state which form the
  // paper used. index.html handled curated models as (1+coef) and library models as exp(coef);
  // encoding the form in the spec makes that distinction explicit instead of implicit.
  var KINDS = {
    power: function (e, x) {
      if (x == null || e.ref == null) return 1;
      return Math.pow(x / e.ref, e.coef);
    },
    exponential: function (e, x) {
      if (x == null) return 1;
      return Math.exp(e.coef * (x - (e.ref || 0)));
    },
    proportional: function (e, x) {
      return matchesLevel(e, x) ? (1 + e.coef) : 1;
    },
    categorical: function (e, x) {
      return matchesLevel(e, x) ? Math.exp(e.coef) : 1;
    },
    multiplier: function (e, x) {
      return matchesLevel(e, x) ? e.coef : 1;
    }
  };

  function matchesLevel(e, x) {
    if (x == null) return false;
    // With no level, the effect applies when the value is truthy (1/true) - e.g. ADA positive.
    if (e.level == null) return x === 1 || x === true;
    return String(x) === String(e.level);
  }

  // ------------------------------------------------------- time-varying CL
  // Time-dependent CL. Widely reported for anti-PD-1/PD-L1 antibodies, but listed as a
  // Non-Goal in the original simulator's PRD (i.e. previously unsupported). Two forms.
  //
  //   sigmoid_emax : CL(t) = CL0 * (1 + Emax * t^g / (T50^g + t^g))
  //   exponential  : CL(t) = CL0 * (1 + Emax * (1 - exp(-kdes * t)))
  //
  // Both give CL0 at t=0 and CL0*(1+Emax) as t goes to infinity. Emax<0 means CL falls over time.
  function timeFactor(tv, t) {
    if (!tv || !tv.enabled) return 1;
    if (t == null || t <= 0) return 1;
    var Emax = tv.Emax;
    if (tv.type === 'exponential') {
      return 1 + Emax * (1 - Math.exp(-tv.kdes * t));
    }
    var g = tv.gamma == null ? 1 : tv.gamma;
    var tg = Math.pow(t, g), t50g = Math.pow(tv.T50, g);
    // exp_sigmoid_emax: CL(t) = CL0 * exp(Emax * t^g / (T50^g + t^g)), the form of the nivolumab
    // SC models - Emax is then a change on the log scale (-0.26 -> CL falls to exp(-0.26) = 77%)
    if (tv.type === 'exp_sigmoid_emax') return Math.exp(Emax * tg / (t50g + tg));
    // default: sigmoid Emax
    return 1 + Emax * tg / (t50g + tg);
  }

  // --------------------------------------------------------------- validation
  function assertSourced(spec) {
    var bad = (spec.effects || []).filter(function (e) {
      return e.enabled && (!e.source || String(e.source).indexOf(UNSOURCED) === 0);
    });
    if (spec.timeVarying && spec.timeVarying.enabled &&
        (!spec.timeVarying.source || String(spec.timeVarying.source).indexOf(UNSOURCED) === 0)) {
      bad.push({ id: 'timeVarying', source: spec.timeVarying && spec.timeVarying.source });
    }
    if (bad.length) {
      throw new Error(
        'A coefficient without a source is enabled - it must not be used in a report: ' +
        bad.map(function (e) { return e.id + '(' + (e.source || 'no source') + ')'; }).join(', ') +
        '\n  -> Fill in the source, or leave the entry enabled:false.');
    }
  }

  // ------------------------------------------------------- parameter computation
  // subject: { WT: 76.8, ALB: 39.6, SEX: 'F', ADA: 0, ... } - keys match the spec's cov names.
  // opts.only : whitelist of effect ids to apply (used by the comparison tiers). Default: all enabled.
  // opts.t    : time in model time units. When given, timeVarying is applied as well.
  function build(spec, subject, opts) {
    opts = opts || {};
    assertSourced(spec);
    var out = {}, k;
    for (k in spec.baseline) out[k] = spec.baseline[k];

    var applied = [];
    (spec.effects || []).forEach(function (e) {
      if (!e.enabled) return;
      if (opts.only && opts.only.indexOf(e.id) < 0) return;
      if (e.coef == null) return;                      // coefficient unknown -> cannot apply
      var fn = KINDS[e.type];
      if (!fn) throw new Error('Unknown effect type: ' + e.type + ' (' + e.id + ')');
      if (out[e.param] == null) return;                // parameter not present in this model
      var f = fn(e, subject ? subject[e.cov] : null);
      out[e.param] *= f;
      if (f !== 1) applied.push({ id: e.id, factor: f });
    });

    if (opts.t != null && spec.timeVarying && spec.timeVarying.enabled &&
        (!opts.only || opts.only.indexOf('timeVarying') >= 0)) {
      var p = spec.timeVarying.param || 'CL';
      if (out[p] != null) {
        var tf = timeFactor(spec.timeVarying, opts.t);
        out[p] *= tf;
        applied.push({ id: 'timeVarying', factor: tf });
      }
    }
    out.__applied = applied;
    return out;
  }

  // When time dependence is on, return a function of t so the simulator can re-query CL at
  // every step. When off, return null and the caller keeps the constant-CL path.
  function clOfTime(spec, subject, opts) {
    if (!spec.timeVarying || !spec.timeVarying.enabled) return null;
    return function (t) { return build(spec, subject, Object.assign({}, opts, { t: t })).CL; };
  }

  // ------------------------------------------------------------- IIV
  // %CV -> log-normal omega. Same formula as omega() in index.html, kept identical for reproducibility.
  function omega(cvPct) {
    if (cvPct == null || isNaN(cvPct)) return 0;
    var cv = cvPct / 100;
    return Math.sqrt(Math.log(1 + cv * cv));
  }

  // Individual parameters: typical * exp(eta). If corr is given, the two etas are correlated.
  //
  // Two notations are supported.
  //   iiv:       {CL:38, Vc:21}                          an independent eta per parameter
  //   iivGroups: [{params:['CL','Q'], cv:28.1}, ...]     several parameters share one eta
  //
  // Why shared etas are needed: the final pembrolizumab model in FDA BLA 125514 Table 16 defines
  // only two etas - "IIV on CL and Q" and "IIV on Vc and Vp" - spread across four parameters.
  // Replacing them with four independent etas lets CL and Q drift apart within a subject and
  // changes the distributional structure.
  function sampleIndiv(spec, typ, rng) {
    var out = Object.assign({}, typ);

    if (spec.iivGroups && spec.iivGroups.length) {
      // one standard-normal draw per group, in group order (the same draws as before)
      var etas = spec.iivGroups.map(function (g) {
        return { g: g, om: g.omega2 != null ? Math.sqrt(g.omega2) : omega(g.cv), z: rng.normal() };
      });
      // iivCorr: [{a, b, rho}] correlates group b with group a (indices into iivGroups)
      (spec.iivCorr || []).forEach(function (c) {
        var A = etas[c.a], B = etas[c.b];
        if (A && B) B.z = c.rho * A.z + Math.sqrt(Math.max(0, 1 - c.rho * c.rho)) * B.z;
      });
      etas.forEach(function (e) {
        var eta = e.z * e.om;                        // one eta shared by the whole group
        e.g.params.forEach(function (p) {
          if (out[p] == null) return;
          if (e.g.transform === 'logit') {           // bioavailability: eta on the logit scale
            var x = Math.min(Math.max(out[p], 1e-9), 1 - 1e-9);
            out[p] = 1 / (1 + Math.exp(-(Math.log(x / (1 - x)) + eta)));
            return;
          }
          // Multiply what is already there, not typ[p], so that groups may overlap: dupilumab's
          // source puts one eta on the central volume (which carries CL, Q and Vp with it) and a
          // second one on the elimination rate constant, and CL takes both. For disjoint groups
          // out[p] still equals typ[p] at this point, so nothing changes for the other specs.
          out[p] = out[p] * Math.exp(eta);
        });
      });
      // a log-normal eta on bioavailability can push it past 1, which is not physical
      if (out.F != null && out.F > 1) out.F = 1;
      return out;
    }

    var iiv = spec.iiv || {};
    var keys = Object.keys(iiv).filter(function (k) { return iiv[k] != null && typ[k] != null; });
    var z = {};
    keys.forEach(function (k) { z[k] = rng.normal(); });
    if (spec.corr && z[spec.corr.a] != null && z[spec.corr.b] != null) {
      var r = spec.corr.rho;
      z[spec.corr.b] = r * z[spec.corr.a] + Math.sqrt(Math.max(0, 1 - r * r)) * z[spec.corr.b];
    }
    keys.forEach(function (k) { out[k] = typ[k] * Math.exp(omega(iiv[k]) * z[k]); });
    return out;
  }

  // omega^2 of the inter-individual variability on CL for this spec (used by variance decomposition).
  // Returns the same value whichever notation (iivGroups / iiv) the spec uses.
  function omega2OfCL(spec) {
    if (spec.iivGroups && spec.iivGroups.length) {
      var g = spec.iivGroups.filter(function (x) { return x.params.indexOf('CL') >= 0; })[0];
      if (!g) return 0;
      return g.omega2 != null ? g.omega2 : Math.pow(omega(g.cv), 2);
    }
    return Math.pow(omega((spec.iiv || {}).CL), 2);
  }

  // --------------------------------------------------- tiers (comparison views of one spec)
  // Builds "no covariates / current / upgraded" from a single spec for side-by-side comparison.
  // The spec is not cloned - only the `only` whitelist changes - which guarantees all three tiers
  // use exactly the same baseline and IIV, keeping the comparison fair.
  function tiers(spec) {
    var enabled = (spec.effects || []).filter(function (e) { return e.enabled; }).map(function (e) { return e.id; });
    var current = (spec.tiers && spec.tiers.current) || enabled;
    var upgraded = enabled.slice();
    if (spec.timeVarying && spec.timeVarying.enabled) upgraded.push('timeVarying');
    return {
      none: { label: 'no covariates', only: [] },
      current: { label: 'current (' + current.join(', ') + ')', only: current },
      upgraded: { label: 'upgraded (' + upgraded.join(', ') + ')', only: upgraded }
    };
  }

  return {
    build: build,
    clOfTime: clOfTime,
    sampleIndiv: sampleIndiv,
    omega: omega,
    timeFactor: timeFactor,
    tiers: tiers,
    omega2OfCL: omega2OfCL,
    assertSourced: assertSourced,
    KINDS: KINDS,
    UNSOURCED: UNSOURCED
  };
}));

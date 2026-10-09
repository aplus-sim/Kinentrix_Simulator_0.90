// vpop.js - virtual population sampler (draws covariates per subject)
//
// Why it exists: sampleCovariates() in the original index.html samples body weight only.
//     function sampleCovariates(cov, wtCV){
//       const out=Object.assign({}, cov);
//       if(cov.wt!=null && wtCV>0){ ... out.wt = ... }   // <- weight only
//       return out;
//     }
//   Sex and albumin are copied unchanged from the on-screen input to every subject. Yet the
//   covariate with the largest exponent on CL in the Keytruda model is albumin (-0.854).
//   So in "virtual population" mode the strongest covariate was frozen at a single value.
//   This module takes over that job.
//
// All distributions are read from the spec (population block) - no numbers are hard-coded here.
// The distributions themselves are assumptions rather than observed data, so each carries a
// source in the spec and is flagged as an assumption in the report.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Vpop = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- RNG
  // Numbers destined for a report must not change between runs, so the RNG is seeded.
  // mulberry32 - short, with good enough statistical properties.
  function RNG(seed) {
    this.s = (seed >>> 0) || 1;
    this._spare = null;
  }
  RNG.prototype.next = function () {
    this.s |= 0; this.s = (this.s + 0x6D2B79F5) | 0;
    var t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Box-Muller (produces values in pairs, so one is cached for the next call)
  RNG.prototype.normal = function () {
    if (this._spare != null) { var s = this._spare; this._spare = null; return s; }
    var u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    var r = Math.sqrt(-2 * Math.log(u));
    this._spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };

  // ------------------------------------------------------------ distributions
  function drawOne(d, rng) {
    switch (d.dist) {
      case 'lognormal': {
        // Parameterised by median/CV - suited to positive, right-skewed variables such as weight.
        var om = Math.sqrt(Math.log(1 + Math.pow(d.cv / 100, 2)));
        return d.median * Math.exp(om * rng.normal());
      }
      case 'normal':
        return d.mean + d.sd * rng.normal();
      case 'bernoulli':
        return rng.next() < d.p ? d.levels[1] : d.levels[0];
      case 'categorical': {
        var u = rng.next(), acc = 0;
        for (var i = 0; i < d.levels.length; i++) {
          acc += d.probs[i];
          if (u < acc) return d.levels[i];
        }
        return d.levels[d.levels.length - 1];
      }
      case 'fixed':
        return d.value;
      default:
        throw new Error('Unknown distribution: ' + d.dist);
    }
  }

  function clamp(v, d) {
    if (typeof v !== 'number') return v;
    if (d.min != null && v < d.min) return d.min;
    if (d.max != null && v > d.max) return d.max;
    return v;
  }

  // -------------------------------------------------------- population generation
  // Example population block:
  //   { "seed":20260907,
  //     "covariates": {
  //        "WT":  {"dist":"lognormal","median":76.8,"cv":22,"min":35,"max":180,"source":"..."},
  //        "ALB": {"dist":"normal","mean":39.6,"sd":4.5,"min":20,"max":55,"source":"..."},
  //        "SEX": {"dist":"bernoulli","p":0.40,"levels":["M","F"],"source":"..."} },
  //     "correlations": [ {"a":"ALB","b":"BSLD","rho":-0.3} ] }
  //
  // Correlation is applied afterwards, for two continuous variables at a time, in a
  // Gaussian-copula style (rank reshuffling). This tool does not need an exact joint
  // distribution - it only needs to express a direction, e.g. "patients with lower albumin
  // tend to have a higher tumour burden".
  function sample(population, n) {
    var rng = new RNG(population.seed || 1);
    var covs = population.covariates || {};
    var names = Object.keys(covs);
    var subjects = [];
    for (var i = 0; i < n; i++) {
      var s = { __id: i + 1 };
      names.forEach(function (k) { s[k] = clamp(drawOne(covs[k], rng), covs[k]); });
      subjects.push(s);
    }
    (population.correlations || []).forEach(function (c) {
      induceRankCorrelation(subjects, c.a, c.b, c.rho, rng);
    });
    return subjects;
  }

  // Reshuffles column b so it attains the target rank correlation with column a
  // (b's marginal distribution is preserved).
  //
  // Method: give each subject a latent variable za matching the rank of its a value, build a
  //   correlated latent zb = rho*za + sqrt(1-rho^2)*e, then hand out the sorted b values in
  //   the rank order of zb.
  //   -> the set of b values is unchanged; only its rank correlation with a moves towards rho.
  function induceRankCorrelation(subjects, a, b, rho, rng) {
    var n = subjects.length;
    if (!n || subjects[0][a] == null || subjects[0][b] == null) return;

    // rank of a (0..n-1) -> latent za via the standard normal quantile
    var rankA = new Array(n);
    subjects.map(function (s, i) { return { i: i, v: s[a] }; })
      .sort(function (x, y) { return x.v - y.v; })
      .forEach(function (o, r) { rankA[o.i] = r; });

    var zb = new Array(n);
    for (var i = 0; i < n; i++) {
      var za = invNorm((rankA[i] + 0.5) / n);
      zb[i] = rho * za + Math.sqrt(Math.max(0, 1 - rho * rho)) * rng.normal();
    }

    // rank of zb -> hand out the sorted b values
    var bSorted = subjects.map(function (s) { return s[b]; }).sort(function (x, y) { return x - y; });
    var order = zb.map(function (v, i) { return { i: i, v: v }; })
      .sort(function (x, y) { return x.v - y.v; });
    order.forEach(function (o, r) { subjects[o.i][b] = bSorted[r]; });
  }

  // Inverse standard normal CDF (Acklam approximation) - used only to turn ranks into latent normals.
  function invNorm(p) {
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
             138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
             66.80131188771972, -13.28068155288572];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
             -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    var pl = 0.02425, q, r;
    if (p < pl) { q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }

  // ------------------------------------------------------------ statistics
  function quantile(sorted, p) {
    if (!sorted.length) return null;
    var idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }
  function summary(values) {
    var v = values.filter(function (x) { return x != null && !isNaN(x); }).slice().sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var mean = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    var varr = v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (v.length - 1 || 1);
    return {
      n: v.length, mean: mean, sd: Math.sqrt(varr),
      cv: mean ? Math.sqrt(varr) / mean * 100 : null,
      p5: quantile(v, 0.05), median: quantile(v, 0.5), p95: quantile(v, 0.95),
      min: v[0], max: v[v.length - 1]
    };
  }
  // Variance on the log scale - used when measuring the share of variability the covariates explain.
  // popPK treats parameters as log-normal, so the decomposition belongs on the log scale too.
  function logVariance(values) {
    var v = values.filter(function (x) { return x != null && x > 0; }).map(Math.log);
    if (v.length < 2) return 0;
    var m = v.reduce(function (a, b) { return a + b; }, 0) / v.length;
    return v.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (v.length - 1);
  }

  return { RNG: RNG, sample: sample, summary: summary, quantile: quantile, logVariance: logVariance };
}));

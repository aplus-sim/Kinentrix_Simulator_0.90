# App and spec reference

How the single-file app is built and how a model is written. The product-level description is in
the [repository README](../README.md); this file is for whoever edits a spec or the UI.

---

## Build

```bash
node app/build.js                                  # -> app/keytruda_simulator.html
node app/build.js --only pembrolizumab             # one drug only
node app/build.js --out ../dist/kinentrix.html     # different output path
```

`build.js` fills four placeholders in `template.html`:

| Placeholder | Filled with |
|---|---|
| `__MODULES__` | `covmodel.js` + `vpop.js` + `pksim.js`, concatenated (they are UMD, so they attach to `window`) |
| `__SPECS__` | every `specs/*.json`, as one object |
| `__CATALOG__` | `app/drug_catalog.json` — the 69 library antibodies, names and counts only |
| `__FONTS__` | `app/fonts.css` — Inter and Geist as base64 woff2 |

Keys beginning with `_` are documentation and are dropped to keep the file small; `_source`
survives, because the app shows it. The result references nothing outside itself — no CDN, no
`fetch`, no font server — so it opens offline by double-click.

**Editing a spec without rebuilding leaves the app on the previous numbers.** The built file is
committed, so it must be rebuilt in the same change as the spec.

---

## Screen map

| Area | Contents |
|---|---|
| 1. Drug – Model | Built from the specs. Drugs with no spec appear greyed out from the catalogue. The model's structure and source are shown beneath |
| 2. Dosing Regimen | Indication presets from `regimenPresets`; route switch; dose, infusion time, loading dose, interval, number of doses, simulation end |
| 3. Covariates | Only the covariates that an **enabled** effect actually uses. Continuous ones get a number box, categorical ones a select |
| 4. Run | Monte-Carlo band, per-subject covariate sampling, residual error, no-covariate overlay, semi-log, N, and the two CSV exports |
| Concentration–Time Profile | Inline SVG: typical curve and the 5–95% band |
| Model validation | Values the source reported separately, recomputed and marked ✓ / ✗ |
| Parameters | θ, covariate effects, η IIV and residual error, each with its source |
| Folded away | Effects switched off (no sourced coefficient) and the list of assumptions |

---

## Writing a spec

A model is one file in `specs/`. The minimum:

```json
{
  "drug": "nivolumab",
  "label": "Nivolumab — 2-compartment IV · <source>",
  "timeUnit": "day", "concUnit": "mg/L",
  "structure": { "cmt": 2, "absorption": false },
  "baseline": { "CL": 0.199, "Vc": 3.63, "Vp": 2.78, "Q": 0.799 },
  "baselineSource": "<document, table, page>",
  "iiv": { "CL": 30, "Vc": 20 },
  "effects": [
    { "id": "CL_WT", "param": "CL", "cov": "WT", "type": "power",
      "ref": 80, "coef": 0.498, "enabled": true, "source": "<document, table>" }
  ],
  "population": {
    "seed": 1,
    "covariates": { "WT": { "dist": "lognormal", "median": 80, "cv": 22, "source": "<...>" } }
  },
  "regimen": { "dose": 240, "tinf_h": 0.5, "tau": 14, "ndose": 6, "tend": 168, "source": "<...>" }
}
```

Several specs may share a `drug`; they then appear together in the **Model (source)** list.

### Covariate relationships (`effects[].type`)

| type | Form | Typical use |
|---|---|---|
| `power` | `P *= (x/ref)^coef` | body weight, albumin |
| `exponential` | `P *= exp(coef*(x-ref))` | continuous linear predictor |
| `proportional` | `P *= (1+coef)` for that level | "female −15.2%" |
| `categorical` | `P *= exp(coef)` for that level | the usual NONMEM categorical |
| `multiplier` | `P *= coef` for that level | library entries such as `CL_ADA "x 1.23"` |

`proportional` and `categorical` differ for the same coefficient (`1−0.152 = 0.848` versus
`exp(−0.152) = 0.859`), so the spec must record which form the paper used.

### Variability

- `iiv` — %CV per parameter, the simple case.
- `iivGroups` — omega² on the log scale; groups may overlap, and a parameter in two groups gets
  both etas. `transform: "logit"` keeps a bounded parameter such as F inside 0–1.
- `iivCorr` — `[{a, b, rho, source}]` correlates the etas of two groups.
- `residualError` — displayed, and added to the band only when the viewer switches it on.

### Routes

`structure.absorption` says which route the source fitted. `routes.iv.tinf_h` and
`routes.sc` (`ka`, `F`) let the other route be offered; the app marks a route the source never
covered. SC dosing sets the infusion time to zero — the depot's `ka` governs the rise.

### Time-varying clearance

```
sigmoid_emax      CL(t) = CL0 * (1 + Emax * t^g / (T50^g + t^g))
exponential       CL(t) = CL0 * (1 + Emax * (1 - exp(-kdes*t)))
exp_sigmoid_emax  CL(t) = CL0 * exp(Emax * t^g / (T50^g + t^g))
```

Without a `timeVarying` block the engine takes the constant-clearance path.

### Regimens and patient groups

- `regimenPresets` — one entry per label regimen: `dose`, `unit` (`mg` / `mg/kg`), `loadDose`,
  `maxDose`, `tau`, `ndose`, `tend`, `tinf_h`, `route`, `wtRange`, `cov`, `note`, `source`.
  The first entry is the screen default. Labels follow one grammar:
  *indication · patient group — route, dose, interval*.
- `populationPresets` — the patient groups a source reports separately. `covariates` overrides
  part of `population.covariates`; `cov` moves the on-screen covariate inputs. Choosing a group
  switches per-subject sampling on.
- A covariate whose distribution is `fixed` (tumour type, product, age band) is a switch, not a
  spread: the on-screen value is used for every subject.

### Validation targets

Values a source reports separately from its parameter table go in two lists:

- `reportedChecks` — computed for the reference subject (every covariate at its reference).
- `covariateChecks` — computed for a subject moved off the reference, which tests the covariate
  term itself. Rows sharing a `group` appear under one heading.

```json
{ "group": "Gout — body weight 93 kg", "metric": "Accum", "cov": { "WT": 93 },
  "dose": 150, "tau": 84, "value": 1.1, "ci": [0.88, 1.32], "unit": "fold",
  "source": "13_FDA_L.pdf 12.3 — ... No interval in the source; +-20% assumed." }
```

Metrics: `CL` (`"at": "steady"` for late in treatment), `CLratio`, `Vss`, `thalf`, `thalf_eff`,
`Cmax_first`, `Ctrough_first`, `Cavg_first`, `AUC_first`, `Cmax_ss`, `Ctrough_ss`, `Cavg_ss`,
`AUCtau_ss`, `AUCratio_ss`, `Accum`. A row may set its own `dose` or `doseMgkg`, `tau`, `tinf_h`,
`route` and `window` (for a first-cycle maximum).

**`ci` is the pass interval**, and the rule is fixed: the source's own interval where it reports
one, otherwise ±20%, with the assumption written into `source`. Of the 155 checks, 53 use the
±20% fallback.

---

## Rules the design keeps

**An unsourced coefficient does not run.** Every effect carries `source` and `enabled`; if
`enabled` is true while `source` starts with `UNSOURCED`, `covmodel.assertSourced()` throws.
Coefficients that are known to exist but have no published value stay in the spec, disabled, so
the gap is visible rather than silently absent.

**A substituted reference value is labelled.** Where a review wrote `median(WGT)` without the
number and another source supplied it, the covariate is marked `refStatus: "SUBSTITUTED"` and the
input box carries a warning.

**Assumptions are not mixed with data.** A population distribution whose `source` starts with
`ASSUMPTION` is listed separately in the assumptions table.

**The seed is fixed.** The same spec and the same N give the same virtual subjects every time, so
a number in a report does not move between runs.

---

## Reading the band

The Monte-Carlo band shows **inter-individual variability only** unless residual error is
switched on. Turning on per-subject covariate sampling **widens** it — that is the real
population spread, and it is correct. What narrows with covariates is the prediction error for
one patient whose covariates are known, which `report.js` shows, not this band.

---

## Related files

| Path | Role |
|---|---|
| `covmodel.js` | Covariate engine — the five relationship forms, shared and correlated etas, time-varying CL |
| `vpop.js` | Virtual population sampler, seeded |
| `pksim.js` | RK4 simulation engine: infusion, depot, Michaelis–Menten, loading dose |
| `specs/*.json` | Model definitions — **adding a file adds a model** |
| `app/drug_catalog.json` | The 69 library antibodies shown greyed out |
| `tools/make_fonts.py` | Rebuilds `app/fonts.css` for the characters the app can draw |
| `report.js` · `compare.js` | Tier comparison as HTML and on the console |
| `vpatients.js` | Virtual-subject CSV from the command line |

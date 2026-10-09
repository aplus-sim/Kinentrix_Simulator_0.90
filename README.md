# KINENTRIX Simulator 0.90

Human PK simulation for antibody therapeutics. A spec-driven population-PK simulator that
ships as **one HTML file**: no server, no network, no external libraries.

---

## 1. Overview — architecture and workflow

Every number on screen comes from a published source and carries its citation. Drugs are data,
not code: there is no per-drug branch anywhere in the engine. Adding a model means adding one
JSON file.

### Workflow

```
Papers, FDA / EMA reviews
        |   read by hand; each value entered with the table, page and sentence it came from
        v
specs/<model>.json          parameters, covariate effects, IIV, regimens, validation targets
        |
        |   node app/build.js      inlines the engine, every spec, the drug catalogue, the fonts
        v
app/keytruda_simulator.html        the deliverable - open it by double-click
```

### Architecture

| Layer | File | Role |
|---|---|---|
| Simulation | `pksim.js` | 1/2-compartment RK4 integrator: optional absorption depot, zero-order infusion, parallel Michaelis–Menten elimination, loading dose, time-varying clearance |
| Covariates | `covmodel.js` | Multiplies each sourced `effect` onto a parameter; refuses to run an enabled effect whose source is missing |
| Population | `vpop.js` | Seeded virtual-subject sampler: log-normal, normal, categorical and fixed covariates, rank correlation |
| Data | `specs/*.json` | One file per published model — the only place a drug is defined |
| Interface | `app/template.html` | The whole UI, chart and validation panel; `__MODULES__`, `__SPECS__`, `__CATALOG__` and `__FONTS__` are filled at build time |
| Build | `app/build.js` | Concatenates the above into the single deliverable file |
| Evidence | `validation/` | An independent Python re-implementation and the comparison report |

The same engine files run in Node (`compare.js`, `report.js`, `validation/app_runner.js`) and in
the browser, so any result can be reproduced outside the app.

---

## 2. Installation and use

### Running the app

No installation. Open the built file:

```
app/keytruda_simulator.html
```

Double-click it, or serve the folder and open it in a browser. It works offline — the engine,
all 15 models, the drug catalogue and both typefaces are inside the file.

### Rebuilding after a change

Node 18 or later, nothing to install:

```bash
node app/build.js
```

Editing a spec and skipping this step leaves the app on the previous numbers.

### Console tools (optional)

```bash
node compare.js --n 2000
node report.js  --n 2000
node compare.js --spec specs/<model>.json
```

### Regenerating the embedded fonts (rare)

Only needed when new characters appear on screen. Requires `fonttools` and `brotli`:

```bash
python tools/make_fonts.py
```

Then rebuild with `node app/build.js`.

### Offline validation (rare)

Requires Python with numpy, scipy and matplotlib:

```bash
python validation/run_validation.py
```

---

## 3. Core capabilities

**Sourced by construction.** Every parameter, covariate coefficient and validation target stores
the document, table and page it came from. An effect switched on without a source raises an
exception at build time, so an unsourced number cannot reach the screen.

**Six drugs, fifteen published models.** Pembrolizumab, nivolumab, dupilumab, canakinumab and
avelumab, plus relatlimab as an engine test case. Where a drug has several published analyses,
each is a separate selectable model. The drug list also shows the 69 antibodies in the parameter
library, greyed out, so what exists beyond the sourced models stays visible.

**IV and SC.** The route can be switched per model, with the absorption depot (k<sub>a</sub>, F)
for subcutaneous dosing; a route the source never fitted is marked as such.

**Regimens as published.** Indication presets carry dose, interval, loading dose, mg/kg scaling,
per-dose cap and weight band, under one label grammar: *indication · patient group — route, dose,
interval*.

**Virtual populations.** Monte-Carlo simulation of N subjects from the model's own IIV, with
optional per-subject covariate sampling, residual error and published patient-group presets. The
seed is fixed, so a run repeats exactly.

**Model validation inside the app.** 155 checks taken from the sources (Cmax, Ctrough, AUC, Vss,
clearance, accumulation, half-life, exposure ratios) are recomputed for every model and compared
with the reported value. The pass interval is the source's own where one is reported and ±20%
where none is. 152 of 155 pass; the three that do not are source-internal inconsistencies
documented in `LIMITATIONS.md`.

**Two CSV exports.** Per-subject parameters with their metrics, and the hourly concentration
profile of every virtual subject.

**Light and dark.** The viewer's choice is remembered; without one the operating system decides.

---

## 4. Contents

| Path | What it is |
|---|---|
| `app/keytruda_simulator.html` | **The deliverable.** One self-contained file, 580 KB |
| `app/template.html` | UI source — edit here, then rebuild |
| `app/build.js` | Build script |
| `app/drug_catalog.json` | Names and model counts of the 69 library antibodies (no parameters) |
| `app/fonts.css` | Inter and Geist, subset and embedded as base64 |
| `specs/*.json` | The 15 models. **Adding a file adds a model** |
| `pksim.js`, `covmodel.js`, `vpop.js` | Simulation engine, covariate engine, population sampler |
| `analysis.js`, `compare.js`, `report.js` | Console comparison and HTML report |
| `validation/VALIDATION_REPORT.md` / `.html` | App engine vs. an independent Python re-implementation, and population reproduction |
| `validation/INPUT_VERIFICATION.md` / `.html` | Evidence that infusion time and regimen inputs reach the simulation |
| `SOURCES.md` / `.html` | Every document behind the numbers, with DOI and agency links |
| `LIMITATIONS.md` | Validation status, engine limits, per-drug caveats, open work |
| `tools/make_fonts.py` | Rebuilds the embedded font subset |
| `tools/wpd2obs.py` | WebPlotDigitizer export to observed concentration curves in a spec |

---

## 5. Appendix — adding a model

Create `specs/<model>.json`. The minimum:

```json
{
  "drug": "nivolumab",
  "timeUnit": "day",
  "structure": { "cmt": 2, "absorption": false },
  "baseline": { "CL": 0.199, "Vc": 3.63, "Vp": 2.78, "Q": 0.799 },
  "baselineSource": "<document, table, page>",
  "iiv": { "CL": 30, "Vc": 20 },
  "effects": [
    { "id": "CL_WT", "param": "CL", "cov": "WT", "type": "power",
      "ref": 80, "coef": 0.498, "enabled": true, "source": "<document, table>" }
  ],
  "population": { "seed": 1, "covariates": { "WT": { "dist": "lognormal", "median": 80, "cv": 22, "source": "<...>" } } },
  "regimen": { "dose": 240, "tinf_h": 0.5, "tau": 14, "ndose": 6, "tend": 168, "source": "<...>" }
}
```

### Covariate relationships (`type`)

| type | Form | Typical use |
|---|---|---|
| `power` | `P *= (x/ref)^coef` | body weight, albumin |
| `exponential` | `P *= exp(coef*(x-ref))` | continuous linear predictor |
| `proportional` | `P *= (1+coef)` | "female −15.2%" |
| `categorical` | `P *= exp(coef)` | the usual NONMEM categorical |
| `multiplier` | `P *= coef` | library entries such as `CL_ADA "x 1.23"` |

`proportional` and `categorical` differ for the same coefficient (`1−0.152 = 0.848` versus
`exp(−0.152) = 0.859`), so the spec must record which form the paper used.

### Time-varying clearance

```
sigmoid_emax      CL(t) = CL0 * (1 + Emax * t^g / (T50^g + t^g))
exponential       CL(t) = CL0 * (1 + Emax * (1 - exp(-kdes*t)))
exp_sigmoid_emax  CL(t) = CL0 * exp(Emax * t^g / (T50^g + t^g))
```

Without a `timeVarying` block the engine takes the constant-clearance path and behaves exactly
as before.

### Validation targets

Values a source reports separately from its parameter table go into two lists and appear in the
app's **Model validation** panel:

- `reportedChecks` — computed for the reference subject (every covariate at its reference value).
- `covariateChecks` — computed for a subject moved off the reference, which tests the covariate
  term itself. Rows sharing a `group` appear under one heading.

Metrics: `CL`, `CLratio`, `Vss`, `thalf`, `thalf_eff`, `Cmax_first`, `Ctrough_first`,
`Cavg_first`, `AUC_first`, `Cmax_ss`, `Ctrough_ss`, `Cavg_ss`, `AUCtau_ss`, `AUCratio_ss` and
`Accum`. A row may override dose, interval, infusion time, route and covariates. `ci` is the pass
interval: the source's own where it reports one, otherwise ±20%, stated in `source`.

---

Copyright © 2026 APLUS Simulation. All Rights Reserved.

Proprietary software. Use, copying, modification and distribution are subject to the terms in
[`LICENSE`](LICENSE); public availability of this repository grants no licence or intellectual
property right. The source documents cited in `SOURCES.md` remain the property of their
publishers. The embedded typefaces, Inter and Geist, are used under the SIL Open Font License 1.1.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/kinentrix_lockup_dark.png">
    <img src="assets/kinentrix_lockup_light.png" alt="KINENTRIX" width="300">
  </picture>
</p>

<h3 align="center">KINENTRIX Simulator 0.90</h3>

<p align="center">
  Human PK simulation for antibody therapeutics, delivered as a single HTML file
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.90-0b1f4d">
  <img alt="Delivery" src="https://img.shields.io/badge/delivery-single%20HTML%20file-1f6feb">
  <img alt="Dependencies" src="https://img.shields.io/badge/runtime%20dependencies-none-2ea043">
  <img alt="Models" src="https://img.shields.io/badge/models-15%20published-0b1f4d">
  <img alt="License" src="https://img.shields.io/badge/license-proprietary-555555">
</p>

---

## Overview

**KINENTRIX Simulator** reproduces published population-PK models of antibody therapeutics and
simulates the human concentration–time profile for a chosen drug, route, regimen and patient,
together with the variability of a virtual population.

Where [KINENTRIX Biologics](https://github.com/aplus-sim/Kinentrix_Biologics_0.90) *predicts* CL
and V for a molecule that has no human data, this tool *reproduces* the models already published
for marketed antibodies — and checks itself against the numbers those sources report.

**Purpose**

- Answer regimen questions on approved antibodies with the manufacturer's own model: what Cmax,
  Ctrough and AUC follow from this dose, this interval, this patient.
- Show how covariates (body weight, albumin, sex, ADA, tumour type …) move exposure, using the
  coefficients the source published rather than a generic approximation.
- Keep every number traceable. Each parameter, covariate coefficient and validation target
  carries the document, table and page it came from, visible in the app.

**At a glance**

| Item | Value |
|---|---|
| Application | One self-contained HTML file — no server, no network, no external libraries |
| Version | 0.90 |
| Drugs · models | 6 drugs, 15 published models (plus 69 library antibodies listed, unselectable) |
| Routes | IV infusion and SC first-order absorption |
| Validation | 155 checks against source-reported values, recomputed on every run — 152 pass |
| Export | Per-subject parameter CSV and hourly concentration-profile CSV |

---

## Architecture and workflow

```
┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│ 1. INPUTS          │     │ 2. MODEL           │     │ 3. SIMULATION      │     │ 4. OUTPUT          │
├────────────────────┤     ├────────────────────┤     ├────────────────────┤     ├────────────────────┤
│ Drug and published │     │ Covariate effects  │     │ RK4 integration of │     │ Concentration-time │
│  model             │     │  applied to CL, Vc,│     │  the regimen       │     │  chart with band   │
│ Route (IV / SC)    │ ──▶│  Vp, Q, ka, F      │ ──▶ │ N virtual subjects │ ──▶│ Cmax, Ctrough, AUC │
│ Regimen            │     │ Time-varying CL    │     │  from the model's  │     │ Model validation   │
│ Covariates         │     │ Michaelis–Menten   │     │  own IIV           │     │ CSV export         │
└────────────────────┘     └────────────────────┘     └────────────────────┘     └────────────────────┘
```

1. **Inputs** — the drug and which published analysis to use, the route, the dosing regimen
   (indication presets carry dose, interval, loading dose, mg/kg scaling and per-dose cap) and
   the patient's covariates.
2. **Model** — each sourced covariate effect multiplies the parameter it belongs to. Models with
   non-linear elimination or a clearance that changes over treatment carry those terms too.
3. **Simulation** — a 1/2-compartment RK4 integrator runs the regimen for the typical patient and
   for N virtual subjects drawn from the model's own inter-individual variability, on a seeded
   RNG so a run repeats exactly.
4. **Output** — the profile with a 5–95% band, the exposure metrics, the validation panel and the
   two CSV exports.

### Model forms supported

| Form | Description |
|---|---|
| **Structure** | One or two compartments, IV infusion or SC depot (k<sub>a</sub>, F) |
| **Elimination** | Linear, or linear plus parallel Michaelis–Menten |
| **Time-varying CL** | `sigmoid_emax`, `exponential`, `exp_sigmoid_emax` |
| **Covariates** | `power`, `exponential`, `proportional`, `categorical`, `multiplier` |
| **Variability** | %CV or omega² groups, correlated etas, logit-scale variability for F |

### Build flow

```
Papers, FDA / EMA reviews
  └─ entered by hand, each value with its table, page and sentence
       specs/<model>.json          parameters · covariates · IIV · regimens · validation targets
         └─ node app/build.js
              ├─ pksim.js · covmodel.js · vpop.js      the engine
              ├─ specs/*.json                          15 models
              ├─ app/drug_catalog.json                 69 library antibodies (names only)
              └─ app/fonts.css                         Inter + Geist, subset, base64
                   └─ app/keytruda_simulator.html      the deliverable, ~580 KB
```

The same engine files run in Node (`compare.js`, `report.js`, `validation/app_runner.js`) and in
the browser, so any result can be reproduced outside the app.

---

## Installation and usage

### Quick start

Open **`app/keytruda_simulator.html`**. Double-click it, or download the raw file from GitHub and
double-click that. There is nothing to install and it works offline — the engine, all 15 models,
the drug catalogue and both typefaces are inside the file.

> Downloading from GitHub: use the **Download raw file** button. Saving the GitHub page with
> Ctrl+S stores the web page, not the application.

### Rebuilding after a change

Node 18 or later, no packages to install:

```bash
node app/build.js
```

Editing a spec and skipping this step leaves the app on the previous numbers.

### Console tools (optional)

```bash
node compare.js --n 2000                     # covariate-tier comparison table
node report.js  --n 2000                     # self-contained report.html with charts
node compare.js --spec specs/<model>.json
```

### Maintenance tasks (rare)

```bash
python tools/make_fonts.py          # rebuild the embedded font subset, then run build.js
python validation/run_validation.py # app engine vs. the independent re-implementation
```

`make_fonts.py` needs `fonttools` and `brotli`; `run_validation.py` needs numpy, scipy and
matplotlib.

---

## Core capabilities

### 1. Sourced by construction
- Every parameter, covariate coefficient and validation target stores the document, table and
  page it came from, shown in the app under **Show model source** / **Show regimen source**.
- An effect switched on without a source raises an exception at build time, so an unsourced
  number cannot reach the screen.
- Coefficients that exist in a source but have no value stay in the spec, disabled, so what is
  still missing remains visible.

### 2. Six drugs, fifteen published models
- Pembrolizumab, nivolumab, dupilumab, canakinumab and avelumab, plus relatlimab as the engine
  test case — the only model that uses Michaelis–Menten elimination, time-varying clearance and
  a tumour-burden covariate at once.
- Where a drug has several published analyses, each is a separate selectable model.
- The drug list also shows the **69 antibodies in the parameter library**, greyed out, so what
  exists beyond the sourced models stays visible.

### 3. Regimens as published
- Indication presets in one grammar: *indication · patient group — route, dose, interval*.
- Dose, interval, loading dose, mg/kg scaling, per-dose cap and weight band per preset; a weight
  outside the preset's band is flagged.
- The time axis follows the course: changing the interval or the number of doses moves the end of
  the simulation with it.

### 4. Virtual populations
- N subjects drawn from the model's own IIV, optionally with per-subject covariate sampling,
  residual error and published patient-group presets.
- Each subject is dosed on their own body weight when the regimen is mg/kg.
- The seed is fixed, so a run repeats exactly.

### 5. Model validation inside the app
- 155 checks taken from the sources (Cmax, Ctrough, AUC, Vss, clearance, accumulation,
  half-life, exposure ratios) are recomputed for every model and compared with the reported value.
- The pass interval is the source's own where one is reported, and ±20% where none is.
- **152 of 155 pass.** The three that do not are source-internal inconsistencies, each explained
  in [`LIMITATIONS.md`](LIMITATIONS.md).
- An independent Python re-implementation in [`validation/`](validation) reproduces the engine
  outside the app; [`validation/INPUT_VERIFICATION.md`](validation/INPUT_VERIFICATION.md) shows
  that the infusion-time and regimen inputs reach the simulation.

### 6. Export and display
- **Parameter CSV** — one row per virtual subject: covariates, dose, individual parameters and
  metrics.
- **Profile CSV** — hourly concentrations, one column per subject, laid out so a spreadsheet can
  open it.
- Light and dark display modes; the choice is remembered per browser.

### Validation summary

| Model | Checks | Pass |
|---|---|---|
| Pembrolizumab · FDA review Table 16 (n=476) | 9 | 9 |
| Pembrolizumab · Freshwater-type (N=2195) | 2 | 2 |
| Pembrolizumab SC · Song 2025 (+ EMA II/0042) | 23 | 23 |
| Nivolumab · Opdualag review Table 78 | 7 | 7 |
| Nivolumab SC · FDA CheckMate-67T | 16 | 15 |
| Nivolumab SC · Zhao 2025 | 8 | 8 |
| Dupilumab · FDA review Model 4 | 21 | 21 |
| Dupilumab · Zhang 2021 (asthma) | 10 | 10 |
| Dupilumab · Nguyen 2026 (EoE) | 9 | 9 |
| Canakinumab · Chakraborty 2012 | 14 | 14 |
| Canakinumab · SJIA (Sun 2016 / EMA II/0026) | 8 | 8 |
| Canakinumab · gout (EMA II/0010) | 7 | 6 |
| Canakinumab · RA (Ait-Oudhia 2012) | 1 | 0 |
| Avelumab · published sponsor analysis | 4 | 4 |
| Relatlimab · Opdualag review Table 77 | 16 | 16 |
| **Total** | **155** | **152** |

---

## Contents

```
Kinentrix_Simulator_0.90/
├─ app/
│  ├─ keytruda_simulator.html   The deliverable - one self-contained file
│  ├─ template.html             UI source; edit here, then rebuild
│  ├─ build.js                  Build script
│  ├─ drug_catalog.json         69 library antibodies (names and model counts only)
│  └─ fonts.css                 Inter and Geist, subset and base64-embedded
├─ specs/                       The 15 models - adding a file adds a model
├─ pksim.js covmodel.js vpop.js Simulation engine, covariate engine, population sampler
├─ analysis.js compare.js report.js   Console comparison and HTML report
├─ validation/                  Independent re-implementation, reports, input verification
├─ tools/                       make_fonts.py (font subset), wpd2obs.py (digitised curves)
├─ assets/                      Logo and icon
├─ SOURCES.md / .html           Every document behind the numbers, with links
├─ LIMITATIONS.md               Validation status, engine limits, per-drug caveats
└─ LICENSE                      License terms
```

### Adding a model

Create `specs/<model>.json` with `structure`, `baseline`, `effects[]`, `population` and
`regimen`, each carrying its `source`, then run `node app/build.js`. No code changes are needed:
there is no per-drug branch anywhere in the engine. The spec reference — covariate forms,
variability, routes, regimen presets and validation targets — is in
[`app/README.md`](app/README.md); the fullest worked example is
[`specs/pembrolizumab_sc_song2025.json`](specs/pembrolizumab_sc_song2025.json).

---

## License

© 2026 APLUS Simulation. All rights reserved.

This software is proprietary. Its use is governed by the terms in [LICENSE](LICENSE).
The source documents cited in [`SOURCES.md`](SOURCES.md) remain the property of their publishers.
The embedded typefaces, Inter and Geist, are used under the SIL Open Font License 1.1.

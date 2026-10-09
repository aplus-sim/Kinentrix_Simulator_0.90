# validation/ — does the app compute the SC models correctly?

Internal verification of the eight subcutaneous models added on 2026-09-18. Nothing here is shown in
the app. Full numbers: [VALIDATION_REPORT.md](VALIDATION_REPORT.md) (generated).

## Run

```
python validation/run_validation.py      # ~30 s; needs node, numpy, scipy, matplotlib
```

| File | Role |
|---|---|
| `app_runner.js` | Runs the app's own engine (`covmodel.js`, `pksim.js`, the spec files) for a list of scenarios |
| `independent.py` | The same models written again from the source documents, without any app code or spec file; its own ODE solver (scipy DOP853) |
| `run_validation.py` | Compares the two, runs the population re-simulation, writes `results/` and `VALIDATION_REPORT.md` |

## What is checked

1. **Parameters (transcription).** Typical parameters built by the app vs a second, independent entry from
   the sources — NONMEM control streams where published (Nguyen 2026, Zhao 2025), tables and printed
   equations otherwise.
2. **Engine.** Concentration–time profiles, app (fixed-step RK4) vs independent solver, same subject,
   regimen and structure, incl. covariates moved away from the reference, loading doses, IV infusion,
   Michaelis–Menten elimination and time-varying CL.
3. **Population.** 1000 virtual subjects from each source's own population table, summarised the way the
   source reports, vs the reported exposures (pass: central value within ±20%). Run with the full source
   model and with the model as the app implements it.

## Findings (run of 2026-09-22)

- **Engine: correct.** All 15 scenarios agree with the independent solution within 0.01% (Nguyen 0.3–1.1%,
  which is the table-vs-code parameter difference below, not the engine).
- **Transcription: correct.** 112/121 parameter values agree within 0.1%. The other 9 are Nguyen 2026,
  where the app uses the paper's Table 2 (rounded values, weight exponents 1.08/0.710) and the independent
  entry uses the published code (1.0775/0.7041); differences below 1%.
- **App simplifications are negligible.** Leaving out Nguyen's transit absorption changes concentrations only
  in the first hours after the first dose (≤4% afterwards); leaving out IIV on the time-varying CL Emax
  (nivolumab, pembrolizumab) moves population exposures by ≤3%.
- **Population reproduction: 41/54 within ±20%** (40/54 with the full model).
  - Reproduced well: nivolumab SC CheckMate-67T (SC arm within 5%, IV arm within 15%), canakinumab SJIA
    (within 5%), dupilumab Zhang 2021 (+7 to +15%).
  - One app check was wrong and has been fixed: 67T's IV "Cmax1" is the maximum over the first 28-day cycle
    (two IV doses) — reproduced at 0.86 that way, 0.65 as a first-dose peak.
  - **Not reproduced (open):**
    - pembrolizumab SC (Song 2025): cycle-1 Cmax and AUC within 12% and steady-state Cmax 6–17% low, but
      troughs 14–37% low and steady-state AUC about 20% low, for SC and IV alike. The FDA reviewer noted the fixed Imax makes population predictions
      of late concentrations too low; the unpublished covariate distributions (albumin, tumour size, eGFR,
      bilirubin) may add to it.
    - dupilumab Nguyen 2026: adults/adolescents 19–26% low, children 10–26% high. The source simulated
      CDC growth curves and trial weights that are not published; the steep weight exponent on CL (1.08)
      makes the result sensitive to them.
    - nivolumab SC Zhao 2025 vs observed 8KX NCA: troughs 20–23% low (small groups, observed data).

## Limits of this check

- The independent entry was made from the same documents as the specs; it catches transcription,
  unit-conversion and engine errors, not errors in the documents.
- Where a source publishes only mean/SD or median/range, the virtual population is an approximation.
- Reported model-based exposures come from post hoc estimates of the trial subjects; the simulation draws new
  subjects, so central values are the fair comparison, spreads less so.

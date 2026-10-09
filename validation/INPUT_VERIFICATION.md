# Input verification — infusion time and dosing regimen

Does what the user types actually reach the simulation? This note records the checks that
answer that for the two inputs most easily taken on trust: **infusion time** and the
**dosing regimen** (dose, interval, loading dose, mg/kg, dose cap, number of doses).

Checked against the working build of 2026-10-09, model **Avelumab (Bavencio) — 2-compartment IV**,
reference subject (WT 71 kg, ALB 40 g/L), unless stated otherwise.

> **Metric names.** The two AUC tiles were renamed the same day: `AUC (0–end)` was replaced by
> **`AUC,τ,single dose`** (AUC over the first dosing interval) and `AUC,τ` became **`AUC,τ,ss`**.
> The whole-window AUC used in §2.3 is therefore computed from the engine directly, not read
> off the screen.

---

## 1. Infusion time

### 1.1 Engine level — concentration rises during the infusion

The same 800 mg given over different infusion times, computed by calling the engine directly
(CL 0.5 L/day, Vc 3.4 L, Vp 1.0 L, Q 0.6 L/day, single dose). Concentrations in mg/L.

| Time | 0 h (bolus) | 1 h infusion | 12 h infusion |
|---|---|---|---|
| 0 h | 235.3 | 0 | 0 |
| 3 h | 226.2 | 227.6 | 57.7 |
| 6 h | 217.7 | 219.1 | 113.1 |
| 9 h | 209.9 | 211.2 | 166.6 |
| **12 h** | 202.7 | 203.9 | **218.1 ← peak** |
| 15 h | 196.0 | 197.1 | 210.3 |

The 12-hour infusion starts at zero, climbs steadily, and peaks **exactly when the infusion ends**.
The dose is delivered as a zero-order rate, and the time grid carries the infusion window and its
end point, so the peak is never stepped over.

### 1.2 App level — avelumab 800 mg every 2 weeks

| Infusion time | Cmax | Ctrough | AUC,τ,single dose | AUC,τ,ss |
|---|---|---|---|---|
| 0.5 h | 274 | 40.98 | 1234 | 1515 |
| 1 h | 273 | 41.03 | 1233 | 1515 |
| 4 h | 267 | 41.33 | 1231 | 1515 |
| 12 h | 255 | 42.15 | 1226 | 1515 |

A longer infusion **lowers the peak and raises the trough, and leaves AUC untouched**. That is the
correct behaviour: AUC at steady state is dose ÷ clearance and does not depend on how fast the
dose goes in. Had this table moved the other way, the input would be wired wrongly.

### 1.3 Why it is hard to see on screen

The default window is 224 days, so a 1-hour infusion spans **0.02 % of the x axis** — less than one
pixel. The rise is in the numbers but not in the picture. To see it, set **Number of doses = 1** and
**Simulation end = 2** days; the axis shortens and the ramp becomes visible.

Choosing the **SC route hides the infusion-time box**: subcutaneous dosing enters through the
absorption rate k<sub>a</sub>, not an infusion, and the infusion time is held at zero.

---

## 2. Dosing regimen

### 2.1 Dose, interval, loading dose

| Setting | Cmax | Cmax,ss | Ctrough | AUC,τ,single dose | AUC,τ,ss |
|---|---|---|---|---|---|
| 800 mg q2w | 273 | 273 | 41.03 | 1233 | 1515 |
| **400 mg** q2w | 136 | 136 | 20.51 | 617 | 758 |
| 800 mg **q4w** | 239 | 239 | **6.68** | 1461 | 1515 |
| **1600 mg loading** → 800 mg q2w | **464** | 273 | 41.03 | **2467** | 1515 |

- **Half the dose halves every value.** The model is linear, so this is the expected result.
- **Interval 2 → 4 weeks drops the trough from 41 to 6.7.** The patient goes longer with no drug.
  The peak falls too (273 → 239) because less accumulates, while AUC,τ,ss stays at dose ÷ CL.
- **A loading dose raises only the first peak** (464) and leaves steady state at 273 — exactly what
  a loading dose is for. The first-interval AUC doubles (1233 → 2467) because the first dose is
  doubled.

### 2.2 mg/kg dosing and the dose cap

| Setting | Dose actually given | Cmax |
|---|---|---|
| 10 mg/kg (body weight 71 kg) | **710 mg** | 242 |
| 10 mg/kg with a 500 mg cap | **500 mg** | 171 |

Body weight is multiplied in and the cap truncates the result. **Each of the 500 virtual subjects is
dosed on their own weight**, not on one representative value — the mechanism behind the paediatric
pembrolizumab regimen (2 mg/kg, maximum 200 mg).

### 2.3 Number of doses

Total AUC over the whole simulated window, computed from the engine (800 mg q2w, 1 h infusion):

| Doses | Total AUC (mg/L·day) |
|---|---|
| 4 | 6061 |
| 12 | 18181 |

Exactly three times as much, as it must be for a linear model.

---

## Conclusion

Both inputs are reflected in the simulation. Infusion time shapes the peak without touching
exposure; dose, interval, loading dose, mg/kg scaling, the dose cap and the number of doses all
feed through with the arithmetic they should. The one caveat is visual, not numerical: a short
infusion is invisible on a long time axis.

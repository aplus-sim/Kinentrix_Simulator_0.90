# -*- coding: utf-8 -*-
"""Independent re-implementation of the SC models added to the app (2026-09-18).

Nothing here reads the app's code or its spec files. Every value was entered again from the source
documents (second, independent transcription) and every equation is written out from the source:
the NONMEM control streams where the paper publishes one (Nguyen 2026, Zhao 2025), otherwise the
printed equations/tables. Units: day, L, mg, mg/L (= ug/mL).

The ODE solver is scipy's DOP853 with tight tolerances, integrating between dosing events -
a different numerical method from the app's fixed-grid RK4, on purpose.

Each model is a dict:
  typ(cov)            -> typical parameters for one subject's covariates
  iiv(rng, P, n)      -> individual parameters (arrays), IIV exactly as the source defines it
  resid(rng, c)       -> concentrations with residual error (only where the source's reported
                         exposures include it)
  pop(rng, n, **kw)   -> covariates of a virtual population drawn from the source's own table
"""
import math
import numpy as np
from scipy.integrate import solve_ivp

H = 24.0                       # hours per day
expit = lambda x: 1.0 / (1.0 + np.exp(-x))
logit = lambda p: np.log(p / (1.0 - p))


def lognorm_mean_sd(rng, mean, sd, n):
    """Log-normal matching an arithmetic mean and SD."""
    s2 = math.log(1 + (sd / mean) ** 2)
    return np.exp(rng.normal(math.log(mean) - s2 / 2, math.sqrt(s2), n))


def lognorm_median_cv(rng, median, cv, n):
    return median * np.exp(rng.normal(0, math.sqrt(math.log(1 + cv ** 2)), n))


def mvn(rng, cov, n):
    return rng.multivariate_normal(np.zeros(len(cov)), np.array(cov), n)


def truncate(rng, draw, lo, hi, n):
    """Rejection-sample draw(k) into [lo, hi)."""
    out = np.empty(0)
    while out.size < n:
        x = draw(4 * n)
        out = np.concatenate([out, x[(x >= lo) & (x < hi)]])
    return out[:n]


# ============================================================================ ODE engine
def simulate(P, doses, t_eval, route):
    """P: dict of arrays (n subjects) CL, Vc, Q, Vp, ka, F, Vmax (conc rate, mg/L/day), Km,
    tvEmax/tvT50/tvHill (exp form, optional), ntr/mtt (transit chain before the depot, optional).
    doses: list of (time, amount array, tinf_day). route 'SC' (depot) or 'IV' (central).
    Returns C (n x len(t_eval)) and cumulative AUC (n x len(t_eval))."""
    n = len(P['CL'])
    ntr = int(P.get('ntr', 0) or 0)
    # state layout per subject: [transit_1..transit_ntr, depot, central, periph, auc]
    k = ntr + 4
    iD, iC, iP, iA = ntr, ntr + 1, ntr + 2, ntr + 3
    CL, Vc, Q, Vp = (np.asarray(P[x], float) for x in ('CL', 'Vc', 'Q', 'Vp'))
    ka = np.asarray(P.get('ka', np.ones(n)), float)
    Vmax = np.asarray(P.get('Vmax', np.zeros(n)), float)
    Km = np.asarray(P.get('Km', np.ones(n)), float)
    tvE = P.get('tvEmax')
    ktr = (ntr / np.asarray(P['mtt'], float)) if ntr else None
    rate = np.zeros(n)

    def rhs(t, y):
        Y = y.reshape(n, k)
        d = np.zeros_like(Y)
        cl = CL
        if tvE is not None:
            h = P['tvHill']
            f = t ** h / (P['tvT50'] ** h + t ** h) if t > 0 else 0.0
            cl = CL * np.exp(np.asarray(tvE) * f)
        Ac = Y[:, iC]
        C = Ac / Vc
        if ntr:
            d[:, 0] = -ktr * Y[:, 0]
            for j in range(1, ntr):
                d[:, j] = ktr * (Y[:, j - 1] - Y[:, j])
            d[:, iD] = ktr * Y[:, ntr - 1] - ka * Y[:, iD]
        else:
            d[:, iD] = -ka * Y[:, iD]
        mm = Ac * Vmax / (Km + np.maximum(C, 0))          # = Vc * Vmax * C / (Km + C)
        d[:, iC] = ka * Y[:, iD] + rate - (cl / Vc) * Ac - (Q / Vc) * Ac + (Q / Vp) * Y[:, iP] - mm
        d[:, iP] = (Q / Vc) * Ac - (Q / Vp) * Y[:, iP]
        d[:, iA] = C
        return d.ravel()

    # event times: dose starts and infusion ends
    events = sorted({0.0, float(t_eval[-1])} | {d[0] for d in doses} | {d[0] + d[2] for d in doses if d[2] > 0})
    y = np.zeros(n * k)
    out = np.full((n, len(t_eval), 2), np.nan)
    t_eval = np.asarray(t_eval, float)
    for a, b in zip(events[:-1], events[1:]):
        Y = y.reshape(n, k)
        rate[:] = 0
        for (td, amt, tinf) in doses:
            if abs(td - a) < 1e-12:
                if route == 'SC':
                    Y[:, 0 if ntr else iD] += amt * np.asarray(P['F'], float)
                elif tinf <= 0:
                    Y[:, iC] += amt
            if route == 'IV' and tinf > 0 and td - 1e-12 <= a < td + tinf - 1e-12:
                rate += amt / tinf
        y = Y.ravel()
        mask = (t_eval >= a) & (t_eval <= b)
        te = t_eval[mask]
        sol = solve_ivp(rhs, (a, b), y, method='DOP853', rtol=1e-9, atol=1e-11,
                        t_eval=te if te.size else None, dense_output=False)
        if te.size:
            Ys = sol.y.reshape(n, k, -1)
            out[:, mask, 0] = Ys[:, iC, :] / Vc[:, None]
            out[:, mask, 1] = Ys[:, iA, :]
        y = sol.y[:, -1] if sol.y.ndim == 2 else sol.y
    return out[:, :, 0], out[:, :, 1]


def schedule(dose, tau, ndose, tinf_h=0.0, load=None):
    """Dose list for simulate(); dose may be an array (mg/kg subjects)."""
    return [(i * tau, (load if (i == 0 and load is not None) else dose), tinf_h / H) for i in range(ndose)]


# ============================================================================ models
MODELS = {}


def model(key):
    def deco(fn):
        MODELS[key] = fn()
        return fn
    return deco


# ---------------------------------------------------------------------------- dupilumab, Zhang 2021
@model('dupilumab_zhang2021')
def _():
    # Zhang et al. 2021 CPT:PSP 10:941 (PMC8376131), Table 3 and the covariate equations in Results:
    #   V2   = 2.76 * (WT/78)^0.667 * (ALB/44)^-0.484
    #   Vmax = 1.39 * (WT/78)^0.224                       [mg/L/day]
    #   Ke   = 0.0418 * (1 + 0.191*ADA) * (WT/78)^0.222 * (CLCRN/111)^0.217
    #   K23 0.0952, K32 0.163 /day; Km 2.08 mg/L; Ka 0.263 /day; Fsc 0.609
    def typ(c):
        WT, ALB, CRCL, ADA = c.get('WT', 78), c.get('ALB', 44), c.get('CRCL', 111), c.get('ADA', 0)
        V2 = 2.76 * (WT / 78) ** 0.667 * (ALB / 44) ** -0.484
        Ke = 0.0418 * (1 + 0.191 * ADA) * (WT / 78) ** 0.222 * (CRCL / 111) ** 0.217
        return dict(CL=Ke * V2, Vc=V2, Q=0.0952 * V2, Vp=V2 * 0.0952 / 0.163, ka=0.263, F=0.609,
                    Vmax=1.39 * (WT / 78) ** 0.224, Km=2.08)

    def iiv(rng, P, n):
        # Table 3 omega^2 (diagonal, no correlations reported): Ke 0.0385, V2 0.00834, Vmax 0.0589, Ka 0.243, Fsc 0.132
        e = rng.normal(0, 1, (n, 5)) * np.sqrt([0.0385, 0.00834, 0.0589, 0.243, 0.132])
        V2f, Kef = np.exp(e[:, 1]), np.exp(e[:, 0])
        out = dict(P)
        out.update(Vc=P['Vc'] * V2f, Q=P['Q'] * V2f, Vp=P['Vp'] * V2f, CL=P['CL'] * V2f * Kef,
                   Vmax=P['Vmax'] * np.exp(e[:, 2]), ka=P['ka'] * np.exp(e[:, 3]),
                   F=np.minimum(P['F'] * np.exp(e[:, 4]), 1.0))   # transform not stated: exponential, capped at 1
        return out

    def pop(rng, n):
        # Table 2, asthma column (N=1912)
        return dict(WT=np.clip(lognorm_median_cv(rng, 78.0, 19.8 / 80.0, n), 32, 186),
                    ALB=np.clip(rng.normal(43.8, 3.5, n), 30, 55),
                    CRCL=np.clip(lognorm_median_cv(rng, 110.9, 37.1 / 116.2, n), 30.1, 377),
                    ADA=(rng.random(n) < 0.145).astype(float))
    return dict(typ=typ, iiv=iiv, pop=pop, route='SC')


# ---------------------------------------------------------------------------- dupilumab, Nguyen 2026
@model('dupilumab_nguyen2026')
def _():
    # Nguyen et al. 2026 CPT (PMC13156347), Data S1 NONMEM control stream (run 4312), $THETA on log scale:
    #   TVCL -1.92971, TVVC 0.872234, TVQ -0.672067, TVVP 0.383045, TVVMAX 0.0636407 [mg/L/day],
    #   TVKM -2.01313, TVKA -1.25946, TVFABS (logit) 0.658249, MTT -2.62284; NN=3, KTR=NN/MTT
    #   CLWGT 1.07751, VSSWT 0.704059 (Vc and Vp), QWT 0.75 FIX, CLABL -1.1611 (ref 45 g/L), ref WT 70 kg
    #   CLEOE -0.0575813, VMAXEOE -0.245722, VSSEOE 0.260672
    #   $DES: dA2 = KA*A6 - KCP*A2 + KPC*A3 - KEL*A2 - A2*VMAX/(KM + C1)
    # (In the published code the EoE thetas are added without an IF(POP) - here they apply to EoE
    #  patients only, which is what the paper's Table 2 describes.)
    def typ(c):
        WT, ALB, eoe = c.get('WT', 70), c.get('ALB', 45), 1.0 if c.get('POP', 'EoE') == 'EoE' else 0.0
        lw = math.log(WT / 70)
        return dict(CL=math.exp(-1.92971 + 1.07751 * lw - 1.1611 * math.log(ALB / 45) - 0.0575813 * eoe),
                    Vc=math.exp(0.872234 + 0.704059 * lw + 0.260672 * eoe),
                    Q=math.exp(-0.672067 + 0.75 * lw),
                    Vp=math.exp(0.383045 + 0.704059 * lw + 0.260672 * eoe),
                    Vmax=math.exp(0.0636407 - 0.245722 * eoe), Km=math.exp(-2.01313),
                    ka=math.exp(-1.25946), F=float(expit(0.658249)), ntr=3, mtt=math.exp(-2.62284))

    def iiv(rng, P, n):
        # $OMEGA: ETA_CL 0.0969803, ETA_VSS 0.0260525 (shared by Vc and Vp); all others 0 FIX
        e = rng.normal(0, 1, (n, 2)) * np.sqrt([0.0969803, 0.0260525])
        out = dict(P)
        out.update(CL=P['CL'] * np.exp(e[:, 0]), Vc=P['Vc'] * np.exp(e[:, 1]), Vp=P['Vp'] * np.exp(e[:, 1]))
        return out

    def resid(rng, c):
        # $ERROR, EoE patients: W = sqrt(RUVCV^2*IPRED^2 + RUVSD^2), RUVCV = exp(-1.38561), RUVSD = exp(2.45942)
        cv, sd = math.exp(-1.38561), math.exp(2.45942)
        return c + rng.normal(0, 1, c.shape) * np.sqrt((cv * c) ** 2 + sd ** 2)

    def pop(rng, n, tier=None, group='adult_adol'):
        # Table S3 (mean, SD): adults 82.6 (20.1), n=235; adolescents 63.8 (16.5), n=97; children 27.2 (11.2), n=98
        # albumin 46.5 (3.07) / 46.8 (3.04) / 45.9 (2.40) g/L
        lo, hi = tier
        if group == 'adult_adol':
            def draw(m):
                a = rng.random(m) < 235 / 332
                return np.where(a, lognorm_mean_sd(rng, 82.6, 20.1, m), lognorm_mean_sd(rng, 63.8, 16.5, m))
            wt = truncate(rng, draw, lo, hi, n)
            alb = rng.normal(46.6, 3.06, n)
        else:
            wt = truncate(rng, lambda m: lognorm_mean_sd(rng, 27.2, 11.2, m), lo, hi, n)
            alb = rng.normal(45.9, 2.40, n)
        return dict(WT=wt, ALB=alb, POP=np.array(['EoE'] * n))
    return dict(typ=typ, iiv=iiv, resid=resid, pop=pop, route='SC')


# ---------------------------------------------------------------------------- nivolumab SC, shared form
def _nivo_sc(th, om, tumour=False):
    """Zhao 2025 File S1 form: TVCL = ACL*(WT/80)^a*(eGFR/90)^b*CL_TIME*exp(sex)*exp(PS)[*exp(tumour)];
    TVV2 = AV2*(WT/80)^c*exp(sex); Q = AQ (no IIV); V3 = AV3*exp(ZV3); KA = TVKA*exp(ZKA);
    TVF1 = AF1*F1SEX (female)*F1PS (PS>=1); F1 = expit(logit(TVF1) + ZF1);
    CL_TIME = exp((AEMAX + ZEMAX) * t^HILL / (T50^HILL + t^HILL))   [additive IIV on Emax]"""
    def typ(c):
        WT, GFR = c.get('WT', 80), c.get('GFR', 90)
        fem, ps1 = c.get('SEX', 'M') == 'F', c.get('PS', '0') == '1+'
        CL = th['CL'] * (WT / 80) ** th['clwt'] * (GFR / 90) ** th['clgfr'] * math.exp(th['clsex'] * fem + th['clps'] * ps1)
        if tumour:
            CL *= math.exp(th['clgc'] * (c.get('TUMOR') == 'gastric') + th['clchl'] * (c.get('TUMOR') == 'cHL'))
        Vc = th['VC'] * (WT / 80) ** th['vcwt'] * math.exp(th['vcsex'] * fem)
        F = th['F'] * (th['fsex'] if fem else 1.0) * (th['fps'] if ps1 else 1.0)
        return dict(CL=CL, Vc=Vc, Q=th['Q'], Vp=th['VP'], ka=th['KA'], F=F,
                    tvEmax=th['EMAX'], tvT50=th['T50'], tvHill=th['HILL'])

    def iiv(rng, P, n):
        e1 = mvn(rng, [[om['cl'], om['clvc']], [om['clvc'], om['vc']]], n)
        e2 = mvn(rng, [[om['ka'], om['kaf']], [om['kaf'], om['f']]], n)
        out = dict(P)
        out.update(CL=P['CL'] * np.exp(e1[:, 0]), Vc=P['Vc'] * np.exp(e1[:, 1]),
                   Vp=P['Vp'] * np.exp(rng.normal(0, math.sqrt(om['vp']), n)),
                   ka=P['ka'] * np.exp(e2[:, 0]), F=expit(logit(np.asarray(P['F'])) + e2[:, 1]),
                   tvEmax=np.asarray(P['tvEmax']) + rng.normal(0, math.sqrt(om['emax']), n))
        return out
    return typ, iiv


@model('nivolumab_sc_67t')
def _():
    # FDA Multi-disciplinary Review BLA 761381/761429, Table 2 (CA20967T final model), reference 80 kg, eGFR 90,
    # male, PS 0. CL0 0.0108 L/h, VC 4.25 L, Q 0.0312 L/h, VP 2.67 L, EMAX -0.260, T50 1410 h, HILL 3.39,
    # KA 0.0123 /h, F1 0.788; CLWTB 0.644, CLGFR 0.306, CLSEX -0.149, CLPS 0.122, VCWTB 0.525, VCSEX -0.228,
    # F1SEX 0.942 (F1PS 1 fixed). Omega: CL 0.135, VC 0.0827, CL:VC 0.0395, VP 0.211, EMAX 0.0572, KA 0.211,
    # F1 0.615 (logit), KA:F1 0.0744.
    th = dict(CL=0.0108 * H, VC=4.25, Q=0.0312 * H, VP=2.67, EMAX=-0.260, T50=1410 / H, HILL=3.39, KA=0.0123 * H, F=0.788,
              clwt=0.644, clgfr=0.306, clsex=-0.149, clps=0.122, vcwt=0.525, vcsex=-0.228, fsex=0.942, fps=1.0)
    om = dict(cl=0.135, vc=0.0827, clvc=0.0395, vp=0.211, emax=0.0572, ka=0.211, f=0.615, kaf=0.0744)
    typ, iiv = _nivo_sc(th, om)

    def pop(rng, n, arm='SC'):
        # FDA review Table 1 (PDF p.187): SC arm N=242 / IV arm N=245
        if arm == 'SC':
            wt, egfr, fem, ps1 = (lognorm_median_cv(rng, 76.5, 18.2 / 77.7, n).clip(35, 153),
                                  rng.normal(64.9, 19.9, n).clip(24.4, 124), 0.347, 0.587)
        else:
            wt, egfr, fem, ps1 = (lognorm_median_cv(rng, 76.6, 16.4 / 77.7, n).clip(47.5, 157),
                                  rng.normal(62.4, 19.8, n).clip(20.7, 118), 0.302, 0.628)
        return dict(WT=wt, GFR=egfr, SEX=np.where(rng.random(n) < fem, 'F', 'M'), PS=np.where(rng.random(n) < ps1, '1+', '0'))
    return dict(typ=typ, iiv=iiv, pop=pop, route='SC')


@model('nivolumab_sc_zhao2025')
def _():
    # Zhao et al. 2025 CPT:PSP (PMC12706396), Table S2 final estimates (CL/Q printed 'mL/hr', read as L/h per
    # the code), form from File S1. CL0 0.0109, VC 4.25, Q 0.0327, VP 2.63, EMAX -0.303, T50 1400 h, HILL 2.82,
    # KA 0.307 /day, F 0.752; CLWTB 0.622, CLeGFR 0.139, CLSEX -0.158, CLPS 0.174, CLGC 0.180, CLCHL -0.330,
    # VcWTB 0.630, VcSEX -0.134, FSEX 0.859, FPS 1.07. Omega: CL 0.114, Vc 0.126, CL:Vc 0.0377, Vp 0.235,
    # Emax 0.0519, Ka 0.0955, F 0.862 (logit), Ka:F 0.213.
    th = dict(CL=0.0109 * H, VC=4.25, Q=0.0327 * H, VP=2.63, EMAX=-0.303, T50=1400 / H, HILL=2.82, KA=0.307, F=0.752,
              clwt=0.622, clgfr=0.139, clsex=-0.158, clps=0.174, clgc=0.180, clchl=-0.330, vcwt=0.630, vcsex=-0.134,
              fsex=0.859, fps=1.07)
    om = dict(cl=0.114, vc=0.126, clvc=0.0377, vp=0.235, emax=0.0519, ka=0.0955, f=0.862, kaf=0.213)
    typ, iiv = _nivo_sc(th, om, tumour=True)

    def pop(rng, n):
        # Zhao 2025 Table 1, CheckMate-8KX SC arm (n=66); no gastric or cHL patients in that arm
        return dict(WT=lognorm_median_cv(rng, 77.8, 18.8 / 78.4, n).clip(42, 133),
                    GFR=rng.normal(77.7, 21.7, n).clip(32.4, 143),
                    SEX=np.where(rng.random(n) < 0.424, 'F', 'M'), PS=np.where(rng.random(n) < 0.636, '1+', '0'),
                    TUMOR=np.array(['NSCLC/other'] * n))
    return dict(typ=typ, iiv=iiv, pop=pop, route='SC')


# ---------------------------------------------------------------------------- pembrolizumab SC, Song 2025
@model('pembrolizumab_sc_song2025')
def _():
    # Fixed IV part: EMA assessment report Keytruda II/0042, Table 10 footnote:
    #   CL = 0.281*(WGT/74.872)^0.534*(ALB/39.0)^-0.849*(BIL/8.90)^-0.0488*(BSLD/90.10)^0.0933*(eGFR/88.71)^0.123
    #        *[(1-0.162) female]*[(1-0.0697) ECOG 0];  Q = 0.889*(WGT/74.872)^0.534
    #   Vc = 3.53*(WGT/74.872)^0.514*(ALB/39.0)^-0.233*[(1-0.131) female]*[(1-0.0590) NSCLC];  Vp = 2.75*(WGT/74.872)^0.514
    #   time: CL*exp((IMAX+eta)*t^2.99/(65.5^2.99+t^2.99)), IMAX -0.218, omega^2 0.0300 additive (Li 2017 ESM code form)
    #   IIV: CL/Q shared 0.0939, Vc/Vp shared 0.0364
    # SC part: Song 2025 EJC Table 1 - Ka 0.322 /day (46.9% CV -> omega^2 0.199), sex on Ka -0.192 (female x0.808),
    #   F 0.599 (logit, 14.2% -> omega^2 0.349), cov(Ka,F) 0.089
    def typ(c):
        WT, ALB, BIL, BSLD, GFR = (c.get(k, d) for k, d in (('WT', 74.872), ('ALB', 39.0), ('BIL', 8.90), ('BSLD', 90.10), ('GFR', 88.71)))
        fem, ecog0, nsclc = c.get('SEX', 'M') == 'F', c.get('ECOG', '1+') == '0', c.get('TUMOR', 'melanoma/other') == 'NSCLC'
        w = WT / 74.872
        CL = 0.281 * w ** 0.534 * (ALB / 39.0) ** -0.849 * (BIL / 8.90) ** -0.0488 * (BSLD / 90.10) ** 0.0933 * (GFR / 88.71) ** 0.123
        CL *= (1 - 0.162) if fem else 1.0
        CL *= (1 - 0.0697) if ecog0 else 1.0
        Vc = 3.53 * w ** 0.514 * (ALB / 39.0) ** -0.233 * ((1 - 0.131) if fem else 1.0) * ((1 - 0.059) if nsclc else 1.0)
        return dict(CL=CL, Vc=Vc, Q=0.889 * w ** 0.534, Vp=2.75 * w ** 0.514, ka=0.322 * ((1 - 0.192) if fem else 1.0),
                    F=0.599, tvEmax=-0.218, tvT50=65.5, tvHill=2.99)

    def iiv(rng, P, n):
        eCL = rng.normal(0, math.sqrt(0.0939), n)
        eV = rng.normal(0, math.sqrt(0.0364), n)
        eKF = mvn(rng, [[0.199, 0.089], [0.089, 0.349]], n)
        out = dict(P)
        out.update(CL=P['CL'] * np.exp(eCL), Q=P['Q'] * np.exp(eCL), Vc=P['Vc'] * np.exp(eV), Vp=P['Vp'] * np.exp(eV),
                   ka=P['ka'] * np.exp(eKF[:, 0]), F=expit(logit(np.asarray(P['F'])) + eKF[:, 1]),
                   tvEmax=np.asarray(P['tvEmax']) + rng.normal(0, math.sqrt(0.0300), n))
        return out

    def pop(rng, n):
        # Song 2025 Table S1 (N=469): weight median 69 (37-144), female 30%, ECOG 0 35%, NSCLC 87%.
        # Albumin, bilirubin, tumour size and eGFR are not published -> kept at the model references.
        return dict(WT=lognorm_median_cv(rng, 69, 0.23, n).clip(37, 144),
                    SEX=np.where(rng.random(n) < 0.30, 'F', 'M'), ECOG=np.where(rng.random(n) < 0.35, '0', '1+'),
                    TUMOR=np.where(rng.random(n) < 0.87, 'NSCLC', 'melanoma/other'))
    return dict(typ=typ, iiv=iiv, pop=pop, route='SC')


# ---------------------------------------------------------------------------- canakinumab
@model('canakinumab_sjia')
def _():
    # EMA II/0026 Table 9: CLD 0.196 L/day (70 kg, albumin 43 g/L), VD 3.63, VP 2.64, PSD 0.463; product D ka 0.295,
    # F 68.9% (Table 13). WT on CLD 0.823, on VD 1.13, on VP 0.616; albumin on CLD -0.986.
    # Omega: CLD 0.131, VD 0.204 (cov 0.126), VP 0.0734, PSD 0.272 (VP:PSD cov 0.0551), ka 0.195.
    def typ(c):
        WT, ALB = c.get('WT', 70), c.get('ALB', 43)
        return dict(CL=0.196 * (WT / 70) ** 0.823 * (ALB / 43) ** -0.986, Vc=3.63 * (WT / 70) ** 1.13,
                    Vp=2.64 * (WT / 70) ** 0.616, Q=0.463, ka=0.295, F=0.689)

    def iiv(rng, P, n):
        a = mvn(rng, [[0.131, 0.126], [0.126, 0.204]], n)
        b = mvn(rng, [[0.0734, 0.0551], [0.0551, 0.272]], n)
        out = dict(P)
        out.update(CL=P['CL'] * np.exp(a[:, 0]), Vc=P['Vc'] * np.exp(a[:, 1]), Vp=P['Vp'] * np.exp(b[:, 0]),
                   Q=P['Q'] * np.exp(b[:, 1]), ka=P['ka'] * np.exp(rng.normal(0, math.sqrt(0.195), n)))
        return out

    def pop(rng, n):
        # EMA II/0026 Table 7, SJIA pool (N=201): weight 32.8 +- 21.0 (9.3-102.6), albumin 33.3 +- 4.7 (21-46)
        return dict(WT=truncate(rng, lambda m: lognorm_mean_sd(rng, 32.8, 21.0, m), 9.3, 102.61, n),
                    ALB=rng.normal(33.3, 4.7, n).clip(21, 46))
    return dict(typ=typ, iiv=iiv, pop=pop, route='SC')


@model('canakinumab_gout_ema')
def _():
    # EMA II/0010 Table 13 (typical 93 kg, 34 y, albumin 43 g/L): CL 0.229, Vc 4.78, Vp 2.98, Q 0.423, ka 0.319, F 0.595
    return dict(typ=lambda c: dict(CL=0.229, Vc=4.78, Vp=2.98, Q=0.423, ka=0.319, F=0.595), route='SC')


@model('canakinumab_ra_aitoudhia2012')
def _():
    # Ait-Oudhia 2012 Table 1 and Results: CL = 0.104*(BWT/70)^(3/4), V = theta*(BWT/70); ka 0.266, F 0.667, Q 0.165
    def typ(c):
        w = c.get('WT', 70) / 70
        return dict(CL=0.104 * w ** 0.75, Q=0.165 * w ** 0.75, Vc=3.71 * w, Vp=2.24 * w, ka=0.266, F=0.667)
    return dict(typ=typ, route='SC')

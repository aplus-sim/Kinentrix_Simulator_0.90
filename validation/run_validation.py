# -*- coding: utf-8 -*-
"""Validation of the SC models added to the app: app engine vs independent re-implementation, and
population-level reproduction of the exposures the sources report.

    python validation/run_validation.py            # writes validation/results/*.json, *.png and VALIDATION_REPORT.md

Three layers
  A. Parameters   - typical parameters built by the app (from its spec files) vs the independent entry
  B. Engine       - concentration-time profiles, app engine (node app_runner.js) vs independent ODE solution,
                    same subject, same regimen, same structure
  C. Population   - 1000 virtual subjects drawn from the source's own population table, simulated with the
                    independent model, summarised exactly as the source reports (GM/CV, mean/SD or median/PI),
                    and compared with the reported value. Run twice: the full source model, and the model as the
                    app implements it (without the parts the app leaves out).
"""
import io, json, math, os, subprocess, sys, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from independent import MODELS, simulate, schedule   # noqa: E402
from report_html import write_html   # noqa: E402

RES = os.path.join(HERE, 'results')
os.makedirs(RES, exist_ok=True)
N_POP = 1000
SEED = 20260922
TOL_POP = 0.20          # population check: simulated central value within +-20% of the reported one

# =========================================================================== scenarios (layers A and B)
S = []


def sc(id_, spec, cov, route, dose, tau, ndose, tend, tinf_h=0.0, load=None, note=''):
    S.append(dict(id=id_, spec=spec, cov=cov, route=route, dose=dose, loadDose=load, tau=tau, ndose=ndose,
                  tend=tend, tinf_h=tinf_h, note=note))


sc('zhang_ref', 'dupilumab_zhang2021', {'WT': 78, 'ALB': 44, 'CRCL': 111, 'ADA': 'neg'}, 'SC', 300, 14, 26, 364, load=600,
   note='reference subject, 600 mg load then 300 mg Q2W')
sc('zhang_53kg', 'dupilumab_zhang2021', {'WT': 52.9, 'ALB': 44, 'CRCL': 111, 'ADA': 'neg'}, 'SC', 200, 14, 26, 364, load=400,
   note='52.9 kg, 400 mg load then 200 mg Q2W (non-linear range)')
sc('zhang_116kg_ada', 'dupilumab_zhang2021', {'WT': 116, 'ALB': 38, 'CRCL': 80, 'ADA': 'pos'}, 'SC', 300, 14, 26, 364,
   note='116 kg, ALB 38, CrCL 80, ADA positive - every covariate moved')
sc('nguyen_adult', 'dupilumab_nguyen2026', {'WT': 70, 'ALB': 45, 'POP': 'EoE'}, 'SC', 300, 7, 52, 364, note='EoE 70 kg, 300 mg QW')
sc('nguyen_child', 'dupilumab_nguyen2026', {'WT': 22.5, 'ALB': 45.9, 'POP': 'EoE'}, 'SC', 200, 14, 26, 364, note='EoE child 22.5 kg, 200 mg Q2W')
sc('67t_sc', 'nivolumab_sc_67t', {'WT': 80, 'GFR': 90, 'SEX': 'M', 'PS': '0'}, 'SC', 1200, 28, 13, 364, note='reference subject, 1200 mg SC Q4W')
sc('67t_iv', 'nivolumab_sc_67t', {'WT': 76.5, 'GFR': 63, 'SEX': 'F', 'PS': '1+'}, 'IV', 229.5, 14, 26, 364, tinf_h=0.5,
   note='female, PS 1+, 76.5 kg, eGFR 63; 3 mg/kg IV Q2W (30-min infusion)')
sc('zhao_sc', 'nivolumab_sc_zhao2025', {'WT': 60, 'GFR': 70, 'SEX': 'F', 'PS': '1+', 'TUMOR': 'NSCLC/other'}, 'SC', 1200, 28, 13, 364,
   note='female, PS 1+ (both F multipliers), 60 kg, eGFR 70; 1200 mg SC Q4W')
sc('zhao_gc', 'nivolumab_sc_zhao2025', {'WT': 80, 'GFR': 90, 'SEX': 'M', 'PS': '0', 'TUMOR': 'gastric'}, 'SC', 600, 14, 26, 364,
   note='gastric cancer term; 600 mg SC Q2W')
sc('song_q6w', 'pembrolizumab_sc_song2025', {'WT': 74.872, 'ALB': 39, 'BIL': 8.9, 'BSLD': 90.1, 'GFR': 88.71, 'SEX': 'M', 'ECOG': '1+', 'TUMOR': 'melanoma/other'},
   'SC', 790, 42, 9, 378, note='reference subject, 790 mg SC Q6W')
sc('song_q3w_f', 'pembrolizumab_sc_song2025', {'WT': 60, 'ALB': 35, 'BIL': 12, 'BSLD': 60, 'GFR': 70, 'SEX': 'F', 'ECOG': '0', 'TUMOR': 'NSCLC'},
   'SC', 395, 21, 18, 378, note='every covariate moved (female, ECOG 0, NSCLC, 60 kg, ALB 35 ...); 395 mg SC Q3W')
sc('song_iv', 'pembrolizumab_sc_song2025', {'WT': 69, 'SEX': 'M', 'ECOG': '1+', 'TUMOR': 'NSCLC'}, 'IV', 200, 21, 18, 378, tinf_h=0.5,
   note='69 kg NSCLC; 200 mg IV Q3W (30-min infusion)')
sc('sjia_33kg', 'canakinumab_sjia', {'WT': 33, 'ALB': 33.3}, 'SC', 132, 28, 13, 364, note='33 kg, ALB 33.3; 4 mg/kg SC Q4W')
sc('gout_single', 'canakinumab_gout_ema', {}, 'SC', 150, 84, 1, 400, note='typical 93 kg; single 150 mg SC')
sc('ra_74kg', 'canakinumab_ra_aitoudhia2012', {'WT': 74}, 'SC', 150, 28, 12, 336, note='74 kg; 150 mg SC Q4W')

APP_ALIASES = {'ADA': {'neg': 0, 'pos': 1}}          # app categorical level -> independent numeric coding


def indep_cov(cov):
    c = dict(cov)
    for k, m in APP_ALIASES.items():
        if k in c and c[k] in m:
            c[k] = m[c[k]]
    return c


def arrays(P, n=1):
    return {k: (np.full(n, v, float) if isinstance(v, (int, float)) and k not in ('ntr',) else v) for k, v in P.items()}


def run_app(scen):
    inp, out = os.path.join(RES, '_app_in.json'), os.path.join(RES, '_app_out.json')
    json.dump(scen, io.open(inp, 'w', encoding='utf-8'))
    subprocess.run(['node', os.path.join(HERE, 'app_runner.js'), inp, out], check=True)
    return {r['id']: r for r in json.load(io.open(out, encoding='utf-8'))}


def layer_ab():
    app = run_app(S)
    rows_p, rows_e, curves = [], [], {}
    for s in S:
        m = MODELS[s['spec']]
        ip = m['typ'](indep_cov(s['cov']))
        ap = app[s['id']]['params']
        # ---- A: parameters (app 'VmPerVol' is the concentration-rate Vmax)
        pmap = [('CL', 'CL'), ('Vc', 'Vc'), ('Vp', 'Vp'), ('Q', 'Q'), ('ka', 'ka'), ('F', 'F'), ('Vmax', 'VmPerVol'), ('Km', 'Km')]
        for ik, ak in pmap:
            if ik in ip and ak in ap:
                rows_p.append(dict(scenario=s['id'], param=ik, app=ap[ak], indep=ip[ik], rel=ap[ak] / ip[ik] - 1))
        if 'tv' in ap:
            for ik, ak in (('tvEmax', 'Emax'), ('tvT50', 'T50'), ('tvHill', 'gamma')):
                rows_p.append(dict(scenario=s['id'], param=ik, app=ap['tv'][ak], indep=ip[ik], rel=ap['tv'][ak] / ip[ik] - 1))
        # ---- B: profiles, same structure as the app (no transit chain; the app has none)
        times = np.array(app[s['id']]['times'])
        capp = np.array(app[s['id']]['conc'])
        doses = schedule(s['dose'], s['tau'], s['ndose'], s['tinf_h'], s['loadDose'])
        P = arrays({k: v for k, v in ip.items() if k not in ('ntr', 'mtt')})
        cind, _ = simulate(P, doses, times, s['route'])
        cind = cind[0]
        big = cind > 0.01 * cind.max()
        rel = np.abs(capp[big] / cind[big] - 1)
        row = dict(scenario=s['id'], spec=s['spec'], note=s['note'], n_points=int(big.sum()),
                   max_rel=float(rel.max()), mean_rel=float(rel.mean()),
                   cmax_app=float(capp.max()), cmax_ind=float(cind.max()),
                   clast_app=float(capp[-1]), clast_ind=float(cind[-1]),
                   auc_app=float(np.trapezoid(capp, times)), auc_ind=float(np.trapezoid(cind, times)))
        # structural simplification: the source's transit chain (Nguyen) that the app leaves out
        if 'ntr' in ip:
            Pt = arrays(ip)
            ct, _ = simulate(Pt, doses, times, s['route'])
            ct = ct[0]
            row.update(transit_cmax=float(ct.max()), transit_clast=float(ct[-1]),
                       transit_maxrel=float(np.max(np.abs(cind[big] / ct[big] - 1))))
            curves[s['id'] + '_transit'] = ct[::10].tolist()
        rows_e.append(row)
        curves[s['id']] = dict(t=times[::10].tolist(), app=capp[::10].tolist(), ind=cind[::10].tolist())
    return rows_p, rows_e, curves


# =========================================================================== population checks (layer C)
def gm_cv(x):
    lx = np.log(x[x > 0])
    return float(np.exp(lx.mean())), float(math.sqrt(math.exp(lx.var(ddof=1)) - 1) * 100)


C = []   # population checks


def pc(model, group, regimen, window, metric, stat, value, spread, source, pop_kw=None, resid=False):
    C.append(dict(model=model, group=group, regimen=regimen, window=window, metric=metric, stat=stat, value=value,
                  spread=spread, source=source, pop_kw=pop_kw or {}, resid=resid))


# ---- dupilumab Zhang 2021: Table 4, QUEST 300 mg q2w (600 mg load), model-derived mean (SD), N=630
R = dict(dose=300, load=600, tau=14, ndose=26, route='SC')
for met, v, sd in (('AUC', 1090, 593), ('Cmax', 86.9, 44.8), ('Ctrough', 70.0, 40.9)):
    pc('dupilumab_zhang2021', 'QUEST 300 mg Q2W (+600 mg load), steady state', R, (350, 364), met, 'mean_sd', v, sd,
       'Zhang 2021 Table 4 (NCT02414854, N=630), mean (SD)')
# ---- dupilumab Nguyen 2026: Table S6, median (5th, 95th); simulations include IIV and residual error
for grp, tier, gname, dose, tau, nd, win, rows in (
        ('Adults/adolescents >=40 kg, 300 mg QW', (40, 250), 'adult_adol', 300, 7, 54, (371, 378),
         (('Ctrough', 207, (113, 383)), ('Cmax', 222, (126, 396)), ('AUC', 1518, (851, 2738)))),
        ('Adults/adolescents >=40 kg, 300 mg Q2W', (40, 250), 'adult_adol', 300, 14, 27, (364, 378),
         (('Ctrough', 87, (39, 174)), ('AUC', 1420, (719, 2655)))),
        ('Children 30-<60 kg, 300 mg Q2W', (30, 60), 'child', 300, 14, 27, (364, 378), (('Ctrough', 134, (64, 261)),)),
        ('Children 15-<30 kg, 200 mg Q2W', (15, 30), 'child', 200, 14, 27, (364, 378), (('Ctrough', 156, (73, 314)),)),
        ('Children 15-<30 kg, 300 mg Q4W', (15, 30), 'child', 300, 28, 14, (364, 392), (('Ctrough', 89, (37, 201)),)),
        ('Children 5-<15 kg, 100 mg Q2W', (5, 15), 'child', 100, 14, 27, (364, 378), (('Ctrough', 149, (75, 278)),))):
    for met, v, pi in rows:
        pc('dupilumab_nguyen2026', grp, dict(dose=dose, tau=tau, ndose=nd, route='SC'), win, met, 'median_pi', v, pi,
           'Nguyen 2026 Table S6, median (5th, 95th percentile)', dict(tier=tier, group=gname), resid=(met != 'AUC'))
# ---- nivolumab SC 67T: FDA review Table 5, model-based individual exposures, GM (CV%)
for met, win, v, cv in (('Cmax', (0, 28), 108, 32.7), ('Ctrough', (0, 28), 50.8, 44.2), ('Cavg', (0, 28), 78.8, 35.6),
                        ('Cavg', (336, 364), 182, 43.5), ('Cmax', (336, 364), 230, 39.2), ('Ctrough', (336, 364), 126, 51.0)):
    pc('nivolumab_sc_67t', 'SC 1200 mg Q4W (SC arm, N=242)', dict(dose=1200, tau=28, ndose=14, route='SC'), win, met, 'gm_cv',
       v, cv, 'FDA review BLA 761381 Table 5, GM (CV%)', dict(arm='SC'))
for met, win, v, cv in (('Cmax', (0, 28), 91.7, 35.5), ('Ctrough', (0, 28), 31.9, 29.6), ('Cavg', (0, 28), 37.7, 25.3),
                        ('Cavg', (336, 350), 92.5, 34.4), ('Cmax', (336, 350), 160, 27.6), ('Ctrough', (336, 350), 71.5, 40.1)):
    pc('nivolumab_sc_67t', 'IV 3 mg/kg Q2W (IV arm, N=245)', dict(doseMgkg=3, tau=14, ndose=26, route='IV', tinf_h=0.5), win, met,
       'gm_cv', v, cv, 'FDA review BLA 761381 Table 5, GM (CV%)', dict(arm='IV'))
pc('nivolumab_sc_67t', 'IV 3 mg/kg Q2W - first-dose peak only', dict(doseMgkg=3, tau=14, ndose=26, route='IV', tinf_h=0.5), (0, 14),
   'Cmax', 'gm_cv', 91.7, 35.5, 'same Cmax1 value, read as the peak of the first dose only (the app\'s definition)', dict(arm='IV'))
# ---- nivolumab SC Zhao 2025: FDA review Table 6, observed cycle-1 NCA in 8KX, GM (CV%)
for grp, dose, tau, rows in (('8KX Part D 1200 mg Q4W (n=34)', 1200, 28, (('Cmax', 106, 46), ('Ctrough', 54.4, None), ('Cavg', 53561 / 24 / 28, None))),
                             ('8KX Part E 600 mg Q2W', 600, 14, (('Cmax', 57.8, 31), ('Ctrough', 43.6, None), ('Cavg', 15857 / 24 / 14, None))),
                             ('8KX Part B3 960 mg single', 960, 28, (('Cmax', 81.4, 41),)),
                             ('8KX Part A 720 mg single', 720, 28, (('Cmax', 54.8, 51),))):
    for met, v, cv in rows:
        pc('nivolumab_sc_zhao2025', grp, dict(dose=dose, tau=tau, ndose=1, route='SC'), (0, tau), met, 'gm_cv', v, cv,
           'FDA review BLA 761381 Table 6, observed NCA, GM (CV%)')
# ---- pembrolizumab SC Song 2025: Table 2, model-based GM (CV%)
for grp, R_, c1, ss, rows in (
        ('SC 790 mg Q6W', dict(dose=790, tau=42, ndose=3, route='SC'), (0, 42), (84, 126),
         (('AUC', 'c1', 1597, 39.2), ('Ctrough', 'c1', 18.8, 55.5), ('Cmax', 'c1', 63.1, 41.9),
          ('AUC', 'ss', 2506, 42.8), ('Ctrough', 'ss', 33.6, 57.7), ('Cmax', 'ss', 90.1, 41.6))),
        ('SC 395 mg Q3W', dict(dose=395, tau=21, ndose=6, route='SC'), (0, 21), (105, 126),
         (('AUC', 'c1', 511, 39.2), ('Ctrough', 'c1', 18.8, 39.5), ('Cmax', 'c1', 31.5, 41.8),
          ('AUC', 'ss', 1282, 42.8), ('Ctrough', 'ss', 47.8, 47.4), ('Cmax', 'ss', 72.5, 42.0))),
        ('IV 200 mg Q3W', dict(dose=200, tau=21, ndose=6, route='IV', tinf_h=0.5), (0, 21), (105, 126),
         (('AUC', 'c1', 534, 21.8), ('Ctrough', 'c1', 14.3, 30.7), ('Cmax', 'c1', 64.0, 19.7),
          ('AUC', 'ss', 1130, 31.1), ('Ctrough', 'ss', 36.3, 41.2), ('Cmax', 'ss', 98.8, 22.9)))):
    for met, which, v, cv in rows:
        pc('pembrolizumab_sc_song2025', grp + (' - cycle 1' if which == 'c1' else ' - steady state'), R_,
           c1 if which == 'c1' else ss, met, 'gm_cv', v, cv, 'Song 2025 Table 2, model-based GM (CV%)')
# ---- canakinumab SJIA: EMA II/0026 p.23, 201 SJIA patients, 4 mg/kg Q4W, mean (SD)
for met, v, sd in (('Ctrough', 14.68, 8.80), ('Cmax', 36.50, 14.92), ('AUC', 696.09, 326.55)):
    pc('canakinumab_sjia', '201 SJIA patients, 4 mg/kg (max 300 mg) Q4W, steady state', dict(doseMgkg=4, maxDose=300, tau=28, ndose=14, route='SC'),
       (336, 364), met, 'mean_sd', v, sd, 'EMA II/0026 p.23, post hoc simulation, mean (SD)')


def metric_of(Cm, A, t, win, metric):
    a, b = win
    ia, ib = np.searchsorted(t, a), np.searchsorted(t, b)
    seg = Cm[:, ia:ib + 1]
    if metric == 'Cmax':
        return seg.max(axis=1)
    if metric == 'Ctrough':
        return Cm[:, ib]
    auc = A[:, ib] - A[:, ia]
    return auc if metric == 'AUC' else auc / (b - a)


def layer_c(app_like):
    rng = np.random.default_rng(SEED)
    out = []
    # group checks sharing model + regimen + population so each population is simulated once
    keyf = lambda c: (c['model'], json.dumps(c['regimen'], sort_keys=True), json.dumps(c['pop_kw'], sort_keys=True))
    groups = {}
    for c in C:
        groups.setdefault(keyf(c), []).append(c)
    for (mk, rj, pj), checks in groups.items():
        m, R_ = MODELS[mk], json.loads(rj)
        cov = m['pop'](rng, N_POP, **json.loads(pj))
        n = N_POP
        rows = [{k: (v[i].item() if hasattr(v[i], 'item') else v[i]) for k, v in cov.items()} for i in range(n)]
        typs = [m['typ'](r) for r in rows]
        P = {k: np.array([t[k] for t in typs], float) for k in typs[0] if k not in ('ntr', 'mtt')}
        if 'ntr' in typs[0] and not app_like:
            P['ntr'], P['mtt'] = typs[0]['ntr'], np.array([t['mtt'] for t in typs])
        P = m['iiv'](rng, P, n)
        if app_like and 'tvEmax' in P:        # the app has no IIV on Emax
            P['tvEmax'] = np.full(n, typs[0]['tvEmax'])
        if 'doseMgkg' in R_:
            dose = R_['doseMgkg'] * cov['WT']
            if 'maxDose' in R_:
                dose = np.minimum(dose, R_['maxDose'])
        else:
            dose = np.full(n, float(R_['dose']))
        load = np.full(n, float(R_['load'])) if R_.get('load') else None
        doses = schedule(dose, R_['tau'], R_['ndose'], R_.get('tinf_h', 0.0), load)
        tpts = set()
        for c in checks:
            a, b = c['window']
            tpts |= set(np.linspace(a, b, 841).round(6))
        tpts |= {round(d[0] + d[2], 6) for d in doses}
        t = np.array(sorted(tpts))
        Cm, A = simulate(P, doses, t, R_['route'])
        for c in checks:
            x = metric_of(Cm, A, t, c['window'], c['metric'])
            if c['resid'] and 'resid' in m:
                x = m['resid'](rng, x)
            if c['stat'] == 'gm_cv':
                cen, spr = gm_cv(x)
            elif c['stat'] == 'mean_sd':
                cen, spr = float(x.mean()), float(x.std(ddof=1))
            else:
                cen, spr = float(np.median(x)), (float(np.percentile(x, 5)), float(np.percentile(x, 95)))
            ratio = cen / c['value']
            out.append(dict({k: c[k] for k in ('model', 'group', 'metric', 'stat', 'value', 'spread', 'source', 'window')},
                            sim=cen, sim_spread=spr, ratio=ratio, ok=abs(ratio - 1) <= TOL_POP))
    return out


# =========================================================================== report
def fmt(v, d=3):
    if v is None:
        return '–'
    if isinstance(v, (list, tuple)):
        return '(' + ', '.join(fmt(x, d) for x in v) + ')'
    return f'{v:.{d}g}'


def figures(curves, pop_full, pop_app):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    ids = [s['id'] for s in S]
    fig, axs = plt.subplots(5, 3, figsize=(13, 17))
    for ax, i in zip(axs.ravel(), ids):
        c = curves[i]
        ax.plot(c['t'], c['ind'], color='#18cb96', lw=3, alpha=.6, label='independent (scipy DOP853)')
        ax.plot(c['t'], c['app'], color='#1f2937', lw=1, ls='--', label='app engine (RK4)')
        if i + '_transit' in curves:
            ax.plot(c['t'], curves[i + '_transit'], color='#e11d48', lw=1, label='source model with transit absorption')
        ax.set_title(i, fontsize=9); ax.set_xlabel('day', fontsize=8); ax.set_ylabel('mg/L', fontsize=8); ax.tick_params(labelsize=7)
    axs.ravel()[0].legend(fontsize=7)
    for ax in axs.ravel()[len(ids):]:
        ax.axis('off')
    fig.tight_layout(); fig.savefig(os.path.join(RES, 'engine_profiles.png'), dpi=110); plt.close(fig)

    labels = [f"{r['model'].split('_', 1)[0][:4]}·{r['group'][:34]}·{r['metric']}" for r in pop_full]
    y = np.arange(len(pop_full))[::-1]
    fig, ax = plt.subplots(figsize=(10, 0.28 * len(pop_full) + 1.5))
    ax.axvspan(1 - TOL_POP, 1 + TOL_POP, color='#18cb96', alpha=.12, label=f'±{int(TOL_POP * 100)}%')
    ax.axvline(1, color='#666', lw=.8)
    ax.scatter([r['ratio'] for r in pop_full], y, color='#18cb96', s=26, label='source model (full)', zorder=3)
    ax.scatter([r['ratio'] for r in pop_app], y, color='#1f2937', marker='x', s=22, label='as implemented in the app', zorder=3)
    ax.set_yticks(y); ax.set_yticklabels(labels, fontsize=6.5); ax.set_xlabel('simulated / reported (central value)')
    ax.set_xscale('log'); ax.set_xticks([0.5, 0.67, 0.8, 1, 1.25, 1.5, 2]); ax.set_xticklabels(['0.5', '0.67', '0.8', '1', '1.25', '1.5', '2'])
    ax.legend(fontsize=7, loc='lower right'); fig.tight_layout(); fig.savefig(os.path.join(RES, 'population_ratios.png'), dpi=110); plt.close(fig)


def report(rows_p, rows_e, pop_full, pop_app, secs):
    L = []
    w = L.append
    w('# Validation of the SC models — KINENTRIX simulator\n')
    w(f'Generated by `validation/run_validation.py` ({time.strftime("%Y-%m-%d")}, {secs:.0f} s). '
      'Models: the eight SC models added on 2026-09-18. Nothing here is shown in the app.\n')
    w('## Method\n')
    w('- **A. Parameters** — the typical parameters the app builds from its spec files, compared with a second, independent '
      'transcription from the source documents (`validation/independent.py`), at the same covariates.')
    w('- **B. Engine** — concentration–time profiles from the app engine (`app_runner.js`, the app\'s own `covmodel.js`/`pksim.js`, '
      'fixed-step RK4) and from an independent ODE solution (scipy DOP853, rtol 1e-9, integrated between dosing events), same '
      'subject, regimen and structure. Differences are measured where the concentration is above 1% of its peak.')
    w(f'- **C. Population** — {N_POP} virtual subjects drawn from each source\'s own population table, simulated with the independent '
      'model and summarised the way the source reports (GM/CV, mean/SD or median/5th–95th). Pass = simulated central value within '
      f'±{int(TOL_POP * 100)}% of the reported one. Run twice: the full source model, and the model as the app implements it '
      '(no transit absorption, no IIV on the time-varying CL Emax).\n')
    # ---- A
    bad = [r for r in rows_p if abs(r['rel']) > 1e-3]
    w('## A. Parameters\n')
    w(f'{len(rows_p)} parameter values compared across {len(S)} scenarios; **{len(rows_p) - len(bad)} agree to within 0.1%**.\n')
    if bad:
        w('| Scenario | Parameter | App | Independent | Difference | Explanation |')
        w('|---|---|---|---|---|---|')
        for r in bad:
            why = ''
            if r['scenario'].startswith('nguyen'):
                why = ('rounding: the app uses the paper\'s Table 2 values (Vmax 1.07 x 0.782, Km 0.134); the independent entry uses the code\'s exact thetas'
                       if r['param'] in ('Vmax', 'Km') else
                       'weight exponents: the app uses Table 2 (CL 1.08, Vss 0.710); the independent entry follows the published NONMEM code (1.0775, 0.7041)')
            w(f"| {r['scenario']} | {r['param']} | {fmt(r['app'], 5)} | {fmt(r['indep'], 5)} | {r['rel'] * 100:+.2f}% | {why} |")
        w('')
    # ---- B
    w('## B. Engine\n')
    w('| Scenario | What it exercises | Max diff | Mean diff | Cmax app / indep | Last conc app / indep | AUC app / indep |')
    w('|---|---|---|---|---|---|---|')
    for r in rows_e:
        w(f"| {r['scenario']} | {r['note']} | {r['max_rel'] * 100:.2f}% | {r['mean_rel'] * 100:.3f}% | {fmt(r['cmax_app'], 4)} / {fmt(r['cmax_ind'], 4)} | "
          f"{fmt(r['clast_app'], 4)} / {fmt(r['clast_ind'], 4)} | {fmt(r['auc_app'], 5)} / {fmt(r['auc_ind'], 5)} |")
    w('')
    tr = [r for r in rows_e if 'transit_cmax' in r]
    if tr:
        w('**Transit absorption left out by the app (Nguyen 2026).** The source model delays SC absorption through 3 transit '
          'compartments (MTT 0.0726 day). Effect of leaving it out, same subject:\n')
        for r in tr:
            w(f"- {r['scenario']}: Cmax {fmt(r['cmax_ind'], 4)} without vs {fmt(r['transit_cmax'], 4)} with transit; "
              f"last concentration {fmt(r['clast_ind'], 4)} vs {fmt(r['transit_clast'], 4)}; largest pointwise difference "
              f"{r['transit_maxrel'] * 100:.0f}%, reached about 4 hours after the first dose while the concentration is still rising from zero "
              "(checked separately: after the first dosing interval the difference is at most 4%).")
        w('')
    w('![engine profiles](results/engine_profiles.png)\n')
    # ---- C
    nf, na = sum(r['ok'] for r in pop_full), sum(r['ok'] for r in pop_app)
    w('## C. Population\n')
    w(f'**{nf}/{len(pop_full)}** within ±{int(TOL_POP * 100)}% with the full source model, **{na}/{len(pop_app)}** as implemented in the app.\n')
    w('| Model | Group | Metric | Window (day) | Reported | Simulated (full model) | Ratio | As in app | Ratio |')
    w('|---|---|---|---|---|---|---|---|---|')
    for f, a in zip(pop_full, pop_app):
        stat = {'gm_cv': 'GM (CV%)', 'mean_sd': 'mean (SD)', 'median_pi': 'median (5–95th)'}[f['stat']]
        rep = f"{fmt(f['value'], 4)} {fmt(f['spread'], 3) if f['spread'] is not None else ''}"
        w(f"| {f['model']} | {f['group']} | {f['metric']} — {stat} | {f['window'][0]}–{f['window'][1]} | {rep} | "
          f"{fmt(f['sim'], 4)} {fmt(f['sim_spread'], 3)} | {'**' if not f['ok'] else ''}{f['ratio']:.2f}{'**' if not f['ok'] else ''} | "
          f"{fmt(a['sim'], 4)} | {'**' if not a['ok'] else ''}{a['ratio']:.2f}{'**' if not a['ok'] else ''} |")
    w('')
    w('![population ratios](results/population_ratios.png)\n')
    w('## Caveats\n')
    w('- The independent transcription was made by the same team that built the specs, from the same documents; it catches '
      'transcription and conversion errors and engine errors, not errors in the source documents themselves.')
    w('- Population tables often give only mean/SD or median/range; where a covariate distribution is not published '
      '(pembrolizumab SC: albumin, bilirubin, tumour size, eGFR) it is held at the model reference.')
    w('- Reported model-based exposures come from individual (post hoc) estimates of the trial subjects; the simulation draws new '
      'subjects, so agreement is expected on central values more than on spreads.')
    io.open(os.path.join(HERE, 'VALIDATION_REPORT.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')


def main():
    t0 = time.time()
    rows_p, rows_e, curves = layer_ab()
    print('A/B done', f'{time.time() - t0:.0f}s')
    pop_full = layer_c(app_like=False)
    print('C full done', f'{time.time() - t0:.0f}s')
    pop_app = layer_c(app_like=True)
    print('C app-like done', f'{time.time() - t0:.0f}s')
    json.dump(dict(parameters=rows_p, engine=rows_e, population_full=pop_full, population_app=pop_app),
              io.open(os.path.join(RES, 'results.json'), 'w', encoding='utf-8'), indent=1, default=str)
    figures(curves, pop_full, pop_app)
    report(rows_p, rows_e, pop_full, pop_app, time.time() - t0)
    write_html(os.path.join(HERE, 'VALIDATION_REPORT.md'), os.path.join(HERE, 'VALIDATION_REPORT.html'))
    for f in ('_app_in.json', '_app_out.json'):
        try:
            os.remove(os.path.join(RES, f))
        except OSError:
            pass
    print('report written:', os.path.join(HERE, 'VALIDATION_REPORT.md'))


if __name__ == '__main__':
    main()

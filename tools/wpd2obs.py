# -*- coding: utf-8 -*-
"""WebPlotDigitizer project (.json) -> "observedProfiles" entries for a spec.

The team digitizes published concentration-time figures with WebPlotDigitizer and keeps the
project file next to the figure (e.g. "Human/10_P1_h.json"). This turns each dataset in such a
file into one observed profile the simulator can overlay on its typical curve.

    python tools/wpd2obs.py FIGURE.json --spec specs/avelumab.json \
        --map "1=1" --map "3=3" --map "10=10" --map "30=20" \
        --unit mg/kg --tinf 1 --tau 14 --ndose 1 --tend 15 --route IV --time hour \
        --label "Study 001 · {dose} mg/kg 첫 투여" --source "12_FDA_M.pdf p34, Figure 6 ..."

--map  dataset name in the digitizer file = dose it stands for. Check the figure legend: the
       digitizer names are typed by hand and can be wrong (avelumab's 20 mg/kg series is named "30").
--n    optional "dose=subjects" pairs, appended to the label as (n=..).
Without --spec the entries are printed; with it they replace the spec's observedProfiles.
"""
import argparse, io, json, sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('wpd')
    ap.add_argument('--spec')
    ap.add_argument('--map', action='append', default=[], help='digitizer name=dose')
    ap.add_argument('--n', action='append', default=[], help='dose=number of subjects')
    ap.add_argument('--unit', default='mg', choices=['mg', 'mg/kg'])
    ap.add_argument('--tinf', type=float, default=0.0, help='infusion time, hours')
    ap.add_argument('--tau', type=float, required=True)
    ap.add_argument('--ndose', type=int, default=1)
    ap.add_argument('--tend', type=float, required=True)
    ap.add_argument('--route', default='IV', choices=['IV', 'SC'])
    ap.add_argument('--time', default='hour', choices=['hour', 'day'], help='unit of the x axis in the figure')
    ap.add_argument('--label', default='{dose} {unit}')
    ap.add_argument('--source', required=True)
    a = ap.parse_args()

    names = dict(m.split('=', 1) for m in a.map)
    subjects = {float(k): int(v) for k, v in (x.split('=', 1) for x in a.n)}
    wpd = json.load(io.open(a.wpd, encoding='utf-8'))
    out = []
    for ds in wpd['datasetColl']:
        if names and ds['name'] not in names:
            print(f"skipped dataset '{ds['name']}' (not in --map)", file=sys.stderr)
            continue
        dose = float(names.get(ds['name'], ds['name']))
        dose = int(dose) if dose.is_integer() else dose
        pts = sorted([round(p['value'][0], 3), round(p['value'][1], 4)] for p in ds['data'])
        label = a.label.format(dose=dose, unit=a.unit)
        if float(dose) in subjects:
            label += f" (n={subjects[float(dose)]})"
        entry = {"label": label, "dose": dose, "unit": a.unit, "tinf_h": a.tinf, "tau": a.tau,
                 "ndose": a.ndose, "tend": a.tend, "route": a.route, "timeScale": a.time,
                 "points": pts, "source": a.source}
        if float(dose) in subjects:
            entry["n"] = subjects[float(dose)]
        out.append(entry)
    out.sort(key=lambda e: e['dose'])

    if not a.spec:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return
    spec = json.load(io.open(a.spec, encoding='utf-8'))
    spec['observedProfiles'] = out
    io.open(a.spec, 'w', encoding='utf-8').write(json.dumps(spec, ensure_ascii=False, indent=2) + '\n')
    print(f"{a.spec}: {len(out)} observed profiles written")


if __name__ == '__main__':
    main()

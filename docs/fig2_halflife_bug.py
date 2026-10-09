import json, csv, io, os, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch
from matplotlib.lines import Line2D

SP = sys.argv[1]
plt.rcParams['font.family'] = 'Malgun Gothic'
plt.rcParams['axes.unicode_minus'] = False

meta = json.load(io.open(os.path.join(SP,'c_meta.json'), encoding='utf-8'))
AN = meta['analytic']

def load(tag):
    t, c = [], []
    with io.open(os.path.join(SP, f'c_{tag}.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            t.append(float(r['time'])); c.append(float(r['conc']))
    return np.array(t), np.array(c)

fig, axes = plt.subplots(1, 2, figsize=(13.2, 5.1), sharey=True)
BAD, GOOD, LINE, DOSE = '#dc2626', '#16a34a', '#0f172a', '#94a3b8'

for ax, p in zip(axes, meta['panels']):
    t, c = load(p['tag'])
    ok = p['nDoseInWin'] == 0
    col = GOOD if ok else BAD

    ax.axvspan(p['tail'], p['tend'], color=col, alpha=0.11, zorder=0)
    for d in p['doses']:                                    # 투여 시점
        ax.axvline(d, color=DOSE, lw=0.8, ls=':', zorder=1)
    ax.plot(t, c, color=LINE, lw=2.0, zorder=3, label='농도–시간 곡선')

    xs = np.linspace(p['tail'], p['tend'], 60)              # 꼬리 회귀 직선
    ax.plot(xs, np.exp(p['icpt'] + p['slope']*xs), color=col, lw=2.6, ls='--', zorder=4,
            label='마지막 20% 구간 회귀선')

    ax.set_yscale('log'); ax.set_ylim(3, 200); ax.set_xlim(0, p['tend'])
    ax.set_xlabel('시간 (일)'); ax.grid(alpha=0.25, which='both', lw=0.5)
    ax.set_xticks(range(0, p['tend']+1, 21))

    mark = '(오류)' if not ok else '(정상)'
    ax.set_title(f"{'A' if not ok else 'B'}.  6회 투여 · {p['tend']}일까지 관찰\n"
                 f"꼬리 구간에 주사 {p['nDoseInWin']}개  →  반감기 {p['thalf']:.2f}일  {mark}",
                 fontsize=12.5, color=col, pad=11, fontweight='bold')
    ax.annotate(f"마지막 20%\n({p['tail']:.0f}–{p['tend']}일)",
                xy=((p['tail']+p['tend'])/2, 4.6), ha='center', va='bottom',
                fontsize=10, color=col, fontweight='bold')

axes[0].set_ylabel('농도 (mg/L, 로그 눈금)')
axes[0].legend(handles=[
    Line2D([],[], color=LINE, lw=2.0, label='농도–시간 곡선'),
    Line2D([],[], color='#666', lw=2.4, ls='--', label='마지막 20% 구간 회귀선'),
    Line2D([],[], color=DOSE, lw=0.9, ls=':', label='투여 시점 (21일마다 6회)'),
], loc='lower left', fontsize=9.5, framealpha=0.95)

fig.suptitle('같은 약·같은 파라미터인데 "언제까지 관찰했나"에 따라 반감기가 2배 달라진다',
             fontsize=14.5, fontweight='bold', y=0.99)
fig.text(0.5, 0.015,
         f'두 그림은 완전히 같은 모델(FDA BLA 125514, CL 0.218 L/day)이다. 차이는 관찰 종료 시점뿐.\n'
         f'A는 꼬리 구간에 주사가 들어가 톱니를 관통하는 직선을 그어 {meta["panels"][0]["thalf"]:.1f}일이 나온다.  '
         f'파라미터로 직접 계산한 정답은 {AN:.2f}일.',
         ha='center', fontsize=10.2, color='#475569')
fig.tight_layout(rect=[0, 0.075, 1, 0.945])
out = os.path.join(SP, 'halflife_bug.png')
fig.savefig(out, dpi=200, facecolor='white')
print('saved', out)

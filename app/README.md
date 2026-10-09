# Keytruda PopPK Simulator — 스펙 주도 단일 HTML 앱

공변량 스펙(JSON) 하나로 약물이 정의되는 시뮬레이터. 현재 Keytruda(pembrolizumab) 1종,
모델 2개가 들어 있고 **약물 추가는 코드 수정 없이 JSON 파일 추가로 끝난다.**

기존 `GY/Simulator/index.html`(69종 라이브러리 앱)과는 별개다. 그쪽은 손대지 않았다.

---

## 실행

```
covariate/app/keytruda_simulator.html   ← 더블클릭
```

CDN·fetch·외부 파일이 하나도 없다(빌드 시 전부 인라인). 인터넷 없이 열린다.

---

## 다시 빌드하기

스펙이나 엔진을 고친 뒤:

```bash
node covariate/app/build.js
```

옵션:

```bash
node covariate/app/build.js --only pembrolizumab          # 특정 약물만 포함
node covariate/app/build.js --out ../../dist/keytruda.html # 출력 경로 지정
```

빌드가 하는 일: `template.html` + `covmodel.js`·`vpop.js`·`pksim.js` + `specs/*.json`
→ 단일 HTML. 스펙에서 `_`로 시작하는 문서용 키는 빼서 크기를 줄인다(`_source`만 남긴다 — 화면에 출처를 띄우므로).

---

## 약물 추가 절차

1. `covariate/specs/<약물>.json` 작성
2. `node covariate/app/build.js`
3. 끝. 드롭다운에 뜬다.

**코드는 건드리지 않는다.** 공변량 종류에 제한이 없다 — IgG처럼 기존 앱에 없던 공변량도
JSON에 한 줄 추가하면 입력칸이 자동 생성되고 계산에 들어간다.

같은 `drug` 값을 가진 스펙이 여러 개면 "모델(출처)" 드롭다운으로 골라 비교할 수 있다
(현재 Keytruda가 그렇다 — FDA n=476 / Freshwater N=2195).

### 최소 스펙

```json
{
  "drug": "nivolumab",
  "label": "Nivolumab — 2-compartment IV (출처 표기)",
  "timeUnit": "day", "concUnit": "mg/L",
  "structure": { "cmt": 2, "absorption": false },
  "baseline": { "CL": 0.199, "Vc": 3.63, "Vp": 2.78, "Q": 0.799 },
  "baselineSource": "…",
  "iiv": { "CL": 30, "Vc": 20 },
  "effects": [
    { "id":"CL_WT", "param":"CL", "cov":"WT", "type":"power",
      "ref":80, "coef":0.498, "enabled":true, "source":"…" }
  ],
  "population": {
    "seed": 1,
    "covariates": { "WT": {"dist":"lognormal","median":80,"cv":22,"source":"ASSUMPTION — …"} }
  },
  "regimen": { "dose":240, "tinf_h":0.5, "tau":14, "ndose":6, "tend":168, "source":"…" }
}
```

선택 항목: `iivGroups`(eta 공유), `reportedChecks`(자체 검증), `residualError`,
`timeVarying`, `tiers.current`, `corr`.

---

## 화면 구성

| 영역 | 내용 |
|---|---|
| 1. 약물 / 모델 | 스펙에서 자동 생성. 모델 출처·구조를 그 자리에 표시 |
| 2. 용법 | 스펙 `regimen`의 승인 용법이 기본값. 출처 문구도 함께 |
| 3. 공변량 | **켜져 있는 effect가 실제로 쓰는 공변량만** 입력칸 생성. 연속형=숫자, 범주형=select |
| 4. 실행 | Monte-Carlo 밴드, 공변량 환자별 샘플링, 공변량 미적용 곡선 겹쳐보기, semi-log |
| 농도–시간 | 인라인 SVG. 5–95% 밴드 + 중앙값 + typical |
| 모델 검증 | 원문이 파라미터 표와 **따로** 보고한 값(반감기·Vss)과 대조해 ✓/✗ |
| 파라미터 | θ 구조 / 공변량 / η IIV / 잔차오차를 출처와 함께 |
| 접기 | 꺼둔 항목(계수 출처 없음) · 가정 목록(관측 아님) |

---

## 설계에서 지킨 것

**출처 없는 계수는 켜지지 않는다.** 모든 effect가 `source` + `enabled`를 갖고,
`enabled:true`인데 `source`가 `UNSOURCED`로 시작하면 `covmodel.assertSourced()`가
예외를 던진다. 계수를 모르는 공변량도 구조는 스펙에 남겨, 무엇이 비어 있는지가 화면에 보인다.

**대체한 기준값을 표시한다.** FDA 리뷰가 `median(WGT)`를 기호로만 쓰고 숫자를 안 실어
다른 출처 값으로 대체한 항목은 `refStatus:"SUBSTITUTED"`로 표시되고, 공변량 입력칸에
"ref 대체값" 경고가 붙는다.

**가정과 데이터를 섞지 않는다.** 모집단 분포의 `source`가 `ASSUMPTION`으로 시작하면
"가정 목록" 표에서 주황색으로 나온다. 현재 Keytruda는 체중·성별은 출처가 있고
알부민·IgG 분포는 가정이다.

**시드가 고정돼 있다.** 같은 스펙·같은 N이면 몇 번을 돌려도 같은 가상환자가 나온다.
보고서 숫자가 실행할 때마다 달라지지 않게 하기 위함이다.

---

## 주의 — 밴드 해석

Monte-Carlo 밴드는 **개체간 변동(IIV)만** 반영한다. 잔차오차(측정 노이즈)는 포함하지 않는다.
FDA 스펙은 잔차오차 30.1%를 파라미터 표에 표시만 하고 밴드에는 넣지 않는다.

그리고 **공변량을 환자별로 샘플링하면 밴드가 넓어진다.** 실제 모집단 변동을 재현하기
때문이며 정상이다. 좁아지는 것은 "공변량을 아는 특정 환자 한 명"의 예측오차이고,
그건 이 앱이 아니라 `covariate/report.js`가 보여준다.

---

## 관련 파일

| 경로 | 역할 |
|---|---|
| `covariate/covmodel.js` | 공변량 엔진 (5가지 관계식, 공유 eta, 시간의존 CL) |
| `covariate/vpop.js` | 가상 모집단 샘플러 (시드 고정) |
| `covariate/pksim.js` | RK4 시뮬레이션 엔진 (`index.html`에서 이식) |
| `covariate/specs/*.json` | 약물 정의 — **여기만 추가하면 약물이 늘어난다** |
| `covariate/report.js` | 티어 비교 리포트(HTML) 생성 |
| `covariate/compare.js` | 같은 비교를 콘솔로 |
| `covariate/vpatients.js` | 가상환자 CSV를 CLI로 |

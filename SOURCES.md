# 출처 목록 — simulator0.90

이 시뮬레이터의 **모든 숫자는 출처가 있다.** 숫자 하나하나의 출처(어느 표, 어느 쪽, 어느 문장)는
`specs/*.json`의 `source` 필드에 그대로 적혀 있고, 앱에서 **Show model source / Show regimen source**를
누르면 같은 문구가 나온다. 이 파일은 그 문구들이 가리키는 **문서 전체 목록**이다.

> **PDF 파일은 이 저장소에 없다.** 아래 링크로 각자 받거나, 팀 드라이브(`keytruda_drive`)의 파일명을 찾는다.
> 링크 확인일: 2026-10-06. 논문 제목과 서지사항은 Crossref에서 DOI로 조회해 확인했다.

---

## 1. 학술 논문

| 쓰인 모델 | 논문 | 제목 | 링크 |
|---|---|---|---|
| `pembrolizumab_sc_song2025` | Song et al. 2025, *Eur J Cancer* 230:115711 | Model-based dose selection and pharmacokinetic bridging of subcutaneous from intravenous pembrolizumab | [doi:10.1016/j.ejca.2025.115711](https://doi.org/10.1016/j.ejca.2025.115711) |
| `pembrolizumab_sc_song2025` | Li et al. 2017, *J Pharmacokinet Pharmacodyn* 44 | Time dependent pharmacokinetics of pembrolizumab in patients with solid tumor — 부록의 NONMEM 코드를 시간의존 CL 식에 썼다 | [doi:10.1007/s10928-017-9528-y](https://doi.org/10.1007/s10928-017-9528-y) |
| `nivolumab_sc_zhao2025`, `nivolumab_sc_67t` | Zhao et al. 2025, *CPT Pharmacometrics Syst Pharmacol* 14:2107–2117 | Model-Informed Drug Development of Subcutaneous Nivolumab: Comparison of Pharmacokinetic Analysis Methods | [doi:10.1002/psp4.70120](https://doi.org/10.1002/psp4.70120) · [PMC12706396](https://pmc.ncbi.nlm.nih.gov/articles/PMC12706396/) |
| `dupilumab_nguyen2026` | Nguyen et al. 2026, *Clin Pharmacol Ther* 119 | Population Pharmacokinetics of Dupilumab in Adults, Adolescents, and Children With Eosinophilic Esophagitis | [doi:10.1002/cpt.70233](https://doi.org/10.1002/cpt.70233) · [PMC13156347](https://pmc.ncbi.nlm.nih.gov/articles/PMC13156347/) |
| `dupilumab_zhang2021` | Zhang et al. 2021, *CPT Pharmacometrics Syst Pharmacol* 10:941–952 | Population pharmacokinetic analysis of dupilumab in adult and adolescent patients with asthma | [doi:10.1002/psp4.12667](https://doi.org/10.1002/psp4.12667) · [PMC8376131](https://pmc.ncbi.nlm.nih.gov/articles/PMC8376131/) |
| `canakinumab_ra_aitoudhia2012` | Ait-Oudhia, Lowe, Mager 2012, *CPT Pharmacometrics Syst Pharmacol* 1:e5 | Bridging Clinical Outcomes of Canakinumab Treatment in Patients With Rheumatoid Arthritis | [doi:10.1038/psp.2012.6](https://doi.org/10.1038/psp.2012.6) · [PMC3603473](https://pmc.ncbi.nlm.nih.gov/articles/PMC3603473/) |
| `canakinumab_sjia` (대조 확인) | Sun et al. 2016, *J Clin Pharmacol* 56 | Pharmacokinetics and Pharmacodynamics of Canakinumab in Patients With Systemic Juvenile Idiopathic Arthritis | [doi:10.1002/jcph.754](https://doi.org/10.1002/jcph.754) |
| `avelumab` (기본 파라미터) | Wilkins et al. 2019, *CPT Pharmacometrics Syst Pharmacol* 8 | Time-Varying Clearance and Impact of Disease State on the Pharmacokinetics of Avelumab in Merkel Cell Carcinoma | [doi:10.1002/psp4.12406](https://doi.org/10.1002/psp4.12406) |
| (미사용 — 한계 설명에만 인용) | Zhao et al. 2024, *Clin Pharmacol Ther* 115 | Model-Based Dose Selection of Subcutaneous Nivolumab in Patients with Advanced Solid Tumors — 라이브러리의 니볼루맙 SC 행(ka 0.396/day, F 0.767)의 원 논문 | [doi:10.1002/cpt.3148](https://doi.org/10.1002/cpt.3148) |

임상시험 등록번호: QUEST(두필루맙 천식) [NCT02414854](https://clinicaltrials.gov/study/NCT02414854).

---

## 2. 미국 FDA 문서

`Regulatory/..._FDA_*.pdf`는 **팀 드라이브의 파일명**이다. `_L` = 허가사항(label), `_M` = 종합심사보고서,
`_CP` = 임상약리 심사보고서.

| 약물 | 드라이브 파일명 | 실제 문서 | 신청번호 | 링크 |
|---|---|---|---|---|
| 펨브롤리주맙 | `keytruda_drive/Regulatory/14_FDA_L.pdf` | KEYTRUDA 허가사항 | BLA 125514 | [DailyMed](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=KEYTRUDA) · [Drugs@FDA](https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=125514) |
| 펨브롤리주맙 | `Regulatory/10_FDA_CP.pdf` | KEYTRUDA 임상약리 심사보고서 Table 16 (n=476) | BLA 125514 | 위와 같은 Drugs@FDA 쪽의 Reviews |
| 펨브롤리주맙 SC | — | KEYTRUDA QLEX 허가사항·심사보고서 | BLA 761467 | [DailyMed](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=KEYTRUDA+QLEX) · [Drugs@FDA](https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=761467) |
| 니볼루맙 SC | — | OPDIVO QVANTIG 허가사항 및 종합심사보고서 | BLA 761381 | [DailyMed](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=OPDIVO+QVANTIG) · [Drugs@FDA](https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=761381) |
| 니볼루맙·렐라틀리맙 | `Regulatory/10_FDA_L.pdf` | OPDUALAG 허가사항 | (스펙에 번호 없음) | [DailyMed](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=OPDUALAG) |
| 니볼루맙·렐라틀리맙 | `Regulatory/11_FDA_M.pdf` | OPDUALAG 종합심사보고서 (집단 PK 표 26·27·75) | (스펙에 번호 없음) | Drugs@FDA의 OPDUALAG → Reviews |
| 아벨루맙 | `Regulatory/15_FDA_L.pdf` | BAVENCIO 허가사항 | BLA 761049 | [DailyMed](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=BAVENCIO) · [Drugs@FDA](https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=761049) |
| 아벨루맙 | `Regulatory/10_FDA_M.pdf` | BAVENCIO 종합심사보고서 | BLA 761049 | 위 Drugs@FDA 쪽의 Reviews |
| 두필루맙 | `Regulatory/10_FDA_L.pdf` | DUPIXENT 허가사항 | — | [DailyMed](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=DUPIXENT) |
| 두필루맙 | `Regulatory/11_FDA_CP.pdf` | DUPIXENT 임상약리 심사보고서 (Table 4.6.8 등) | — | Drugs@FDA의 DUPIXENT → Reviews |
| 카나키누맙 | `Regulatory/13_FDA_L.pdf` | ILARIS 허가사항 | — | [DailyMed](https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=ILARIS) |
| 카나키누맙 | `Regulatory/10_FDA_CP.pdf` | ILARIS 임상약리 심사보고서 | — | Drugs@FDA의 ILARIS → Reviews |

> 신청번호가 없는 칸은 스펙이 번호를 적어 두지 않은 것이다. 추측해서 적지 않았다 —
> Drugs@FDA에서 제품명으로 찾으면 된다.

---

## 3. 유럽 EMA 문서

변경신청(variation) 보고서는 해당 의약품의 EPAR 쪽 아래 **Assessment history**에 있다.

| 약물 | 절차번호 | 내용 | EPAR |
|---|---|---|---|
| 카나키누맙 | EMEA/H/C/001109/II/0010 | 통풍 발작 적응증 변경 — 집단 PK와 정상상태 모의 | [Ilaris](https://www.ema.europa.eu/en/medicines/human/EPAR/ilaris) |
| 카나키누맙 | EMEA/H/C/001109/II/0026 | 스틸병(AOSD·SJIA) 변경 — 파라미터 표·환자군 표 | [Ilaris](https://www.ema.europa.eu/en/medicines/human/EPAR/ilaris) |
| 펨브롤리주맙 | EMEA/H/C/003820/II/0042 | 시간의존 CL 모델(Table 10)과 기준 공변량 값 | [Keytruda](https://www.ema.europa.eu/en/medicines/human/EPAR/keytruda) |
| 아벨루맙 | EMA/496529/2017 | 초기 심사보고서 — Figure 6의 관측 농도 곡선 | [Bavencio](https://www.ema.europa.eu/en/medicines/human/EPAR/bavencio) |

---

## 4. 내부 자료

| 파일 | 내용 |
|---|---|
| `GY/Simulator/data/PPKPARAMETER.csv` | 항체의약품 69종 집단 PK 파라미터 라이브러리. 약물 목록(`app/drug_catalog.json`)의 바탕 |
| `GY/BetaBeta/data/Regimen_merged.xlsx` | 용법 정리표 (니볼루맙 단독요법 용법의 출처) |
| `GY/Simulator/papers/` | 이전 작업에서 받아 둔 논문 5편 (Broeder 2002, Chen 2018, Weisman 2003, Ternant 2014, Eculizumab) |

---

## 읽는 순서

1. 앱에서 숫자를 보고 → **Show model source**를 눌러 출처 문구를 읽는다.
2. 문구의 문서 이름을 이 파일에서 찾아 → 링크로 원본을 연다.
3. 검증에 쓴 값과 통과 여부는 `validation/VALIDATION_REPORT.md`, 한계는 `LIMITATIONS.md`에 있다.

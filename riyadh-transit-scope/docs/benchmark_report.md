# Multi-City Transit Benchmark

*Cities:* Riyadh, Melbourne, Los Angeles  
*Generated:* 2026-09-28 by `riyadh-transit-scope`

> **Data note.** Indicative, rounded figures compiled for comparative research demonstration. Values mix published agency statistics and analyst estimates of differing years and definitions; verify against primary sources before citing. Override with `transit benchmark --data your_profiles.json`.

## Side-by-side comparison

| Metric | Unit | Riyadh | Melbourne | Los Angeles |
|---|---|---:|---:|---:|
| Urban extent | km² | 1,800 | 2,540 | 3,700 |
| Network coverage area | km² | 720 | 1,900 | **2,300** |
| Coverage vs. urban extent | % | 40.0 | **74.8** | 62.2 |
| Total route length | km | 2,076 | **7,155** | 3,975 |
| Route density | km/km² | 1.15 | **2.82** | 1.07 |
| Rapid transit route length | km | 176 | **405** | 175 |
| Rapid transit share of route-km | % | **8.5** | 5.7 | 4.4 |
| Mean peak headway | min | **14.2** | 19.0 | 14.7 |
| Rapid transit : bus fleet ratio | × | 0.54 | **0.69** | 0.20 |
| Public transit modal split | % | 2.0 | **12.0** | 5.0 |
| Monthly pass / household income | % | **0.87** | 2.31 | 1.04 |
| Fare accessibility index | /100 | **91.3** | 76.9 | 89.6 |
| Route-km per 100k residents | km | 29.7 | **137.6** | 39.8 |

Bold marks the best value in each row (urban extent is context only).

## Key findings

- **Network coverage area:** Los Angeles leads at 2,300 km²; Riyadh trails at 720 km² (3.2× difference).
- **Coverage vs. urban extent:** Melbourne leads at 74.8 %; Riyadh trails at 40.0 % (1.9× difference).
- **Total route length:** Melbourne leads at 7,155 km; Riyadh trails at 2,076 km (3.4× difference).
- **Route density:** Melbourne leads at 2.82 km/km²; Los Angeles trails at 1.07 km/km² (2.6× difference).
- **Rapid transit route length:** Melbourne leads at 405 km; Los Angeles trails at 175 km (2.3× difference).
- **Rapid transit share of route-km:** Riyadh leads at 8.5 %; Los Angeles trails at 4.4 % (1.9× difference).
- **Mean peak headway:** Riyadh leads at 14.2 min; Melbourne trails at 19.0 min (1.3× difference).
- **Rapid transit : bus fleet ratio:** Melbourne leads at 0.69 ×; Los Angeles trails at 0.20 × (3.5× difference).
- **Public transit modal split:** Melbourne leads at 12.0 %; Riyadh trails at 2.0 % (6.0× difference).
- **Monthly pass / household income:** Riyadh leads at 0.87 %; Melbourne trails at 2.31 % (2.7× difference).
- **Fare accessibility index:** Riyadh leads at 91.3 /100; Melbourne trails at 76.9 /100 (1.2× difference).
- **Route-km per 100k residents:** Melbourne leads at 137.6 km; Riyadh trails at 29.7 km (4.6× difference).

## Mode supply detail

| City | Mode | Route km | Lines | Fleet | Peak headway (min) |
|---|---|---:|---:|---:|---:|
| Riyadh | rapid transit | 176 | 6 | 452 | 5.0 |
| Riyadh | bus | 1,900 | 80 | 842 | 15.0 |
| Melbourne | rapid transit | 405 | 16 | 1,320 | 10.0 |
| Melbourne | light rail | 250 | 24 | 475 | 8.0 |
| Melbourne | bus | 6,500 | 340 | 1,900 | 20.0 |
| Los Angeles | rapid transit | 175 | 6 | 450 | 9.0 |
| Los Angeles | bus | 3,800 | 117 | 2,300 | 15.0 |

## Methodology

- **Coverage vs. urban extent** = network walk-catchment area ÷ built-up urban area.
- **Route density** = total one-way route-km (all modes) ÷ urban extent.
- **Mean peak headway** = route-km-weighted mean of modal peak headways.
- **Rapid transit : bus fleet ratio** = rail rapid-transit revenue vehicles ÷ buses.
- **Fare accessibility index** = 100 × (1 − monthly-pass burden ÷ 10%), clamped to 0–100; burden = monthly pass (USD) ÷ median monthly household income (USD).

## City notes & sources

### Riyadh, Saudi Arabia (2025)

- Coverage definition: Union of 1 km (rail) and 500 m (bus) stop catchments
- Monthly pass: 140 SAR (≈ USD 37)
- Notes: Metro opened in phases from Dec 2024; modal split reflects pre-opening baseline.
- Source: Royal Commission for Riyadh City — Riyadh Metro & bus programme fact sheets
- Source: GASTAT household income & expenditure survey (national, scaled)
- Source: Modal split: pre-metro household travel surveys (≈1–2%)

### Melbourne, Australia (2024)

- Coverage definition: Union of 800 m (rail/tram) and 400 m (bus) stop catchments
- Monthly pass: 191 AUD (≈ USD 125)
- Notes: Tram network (world's largest) is street-running and reported as light rail.
- Source: Department of Transport and Planning Victoria — network statistics
- Source: ABS Census — method of travel to work
- Source: Public Transport Victoria — myki Pass fares (28+ day rate)

### Los Angeles, United States (2024)

- Coverage definition: Union of 800 m (rail/BRT) and 400 m (bus) stop catchments, LA Metro service area
- Monthly pass: 72 USD (≈ USD 72)
- Notes: Rapid transit includes heavy rail (B/D) and grade-separated light rail lines (A/C/E/K).
- Source: LA Metro — facts at a glance
- Source: US Census ACS — means of transportation to work (LA County)
- Source: LA Metro fare capping (monthly equivalent)

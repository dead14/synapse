# Kerangka Ide Tesis: TIE-IN GW Pipeline Alignment

> Hierarchical spatial alignment of in-line inspection data using girth weld matching

---

## Konteks

Alignment dua run ILI (In-Line Inspection) adalah masalah nyata yang belum punya solusi standar di industri pipeline integrity. Sebagian besar operator masih menggunakan Excel manual atau tool vendor yang bersifat black-box. Sistem Synapse menggabungkan **ordered anchor matching**, **Dynamic Time Warping**, dan **monotonic assignment** dalam satu pipeline hierarkis — pendekatan yang belum banyak dipublikasikan di literatur.

### Masalah inti

Setiap kali ILI tool (smart pig) melewati pipeline, ia merekam jarak menggunakan odometer sendiri. Odometer ini drift dan tidak pernah identik antar run. Pig tahun 2020 mungkin mencatat sebuah girth weld di 15.234,567 m, sementara pig tahun 2026 mencatat weld fisik yang sama di 15.274,891 m. Perbedaan ini disebut **odometer drift/slippage**.

Untuk menilai laju pertumbuhan korosi dan membuat keputusan fitness-for-service, engineer harus menentukan anomali mana di Run A yang merupakan defek fisik yang sama dengan anomali di Run B — meskipun setiap run menggunakan odometer berbeda dengan karakteristik drift berbeda.

**Kesalahan alignment berakibat:**
- Missing a growing defect → risiko keselamatan
- Flagging phantom new defects → pemborosan operasional

---

## Opsi 1 — Hierarchical Spatial Calibration (REKOMENDASI)

**Judul:**
*"Hierarchical Spatial Calibration Method for Partial-Overlap In-Line Inspection Data Alignment Using Ordered Anchor Dynamic Programming and Modified Dynamic Time Warping"*

### Fokus
Metode kalibrasi spasial hierarkis untuk menyelaraskan dua dataset ILI yang memiliki overlap parsial.

### Algoritma yang digunakan
- **Ordered-drift-spans** — dynamic programming pada urutan anchor (valve, tee, flange) untuk menemukan overlap fisik
- **Theil-Sen estimator + IRLS** — robust affine fitting sebagai diagnostic
- **Piecewise-linear transform** — knot mapping dari koordinat OLD ke NEW
- **Modified DTW** — Dynamic Time Warping pada sequence girth weld dengan cost function berbasis OTA (Odometer Tolerance Allowance)
- **Valve-to-valve anchoring** — segmentasi pipeline menggunakan mega-anchor (valve/tee) lalu DTW independen per segmen

### Kontribusi unik
Tidak ada publikasi yang menggabungkan ordered anchor DP + robust affine fitting + GW-level DTW sebagai pipeline tunggal. Mayoritas paper alignment ILI mengasumsikan full-overlap dan single-phase matching.

### Detail teknis

**Fase 0 — TIE-IN (Spatial Calibration)**
1. Ekstrak physical anchors (welds, flanges, valves, tees, bends, launchers, receivers) dari kedua run
2. Dynamic programming `find_overlap_candidates` untuk menemukan monotonic local alignments
3. Scoring: node type matching + wall thickness similarity + joint length similarity + clock position + inter-anchor span agreement
4. Robust affine model (Theil-Sen + IRLS)
5. Piecewise-linear knot mapping
6. Engineering quality gates (geometry gate breaches, local scale range, offset baseline shifts)
7. Keputusan: `AUTO_ACCEPTED` atau `REVIEW_REQUIRED` dengan reason codes

**Fase 1 — GW Alignment (Girth Weld Matching)**
1. Modified DTW cost matrix berbasis OTA percentage
2. Multi-skip lookback (hingga K=10) untuk handle inserted/removed pipe joints
3. Optional valve-to-valve anchoring sebagai mega-anchor
4. Output: pasangan GW yang di-lock sebagai batas segmen untuk fase berikutnya

### Cocok untuk
- S2 Teknik Informatika / Teknik Komputer
- Metode riset: Eksperimental — benchmark vs manual alignment

### Evaluasi
| Kriteria | Nilai |
|---|---|
| Novelty | Tinggi (85%) |
| Feasibility | Sangat tinggi (90%) |
| Implementasi | Sudah lengkap |
| Data validasi | Tersedia |
| Gap literatur | Signifikan |
| Target selesai | < 1 tahun |
| Potensi publikasi | Tinggi |

---

## Opsi 2 — Monotonic Constrained Assignment

**Judul:**
*"Monotonic Constrained Assignment for Corrosion Feature Matching Across Pipeline Inspection Epochs Using Modified Hungarian Algorithm with Fenwick Tree Optimization"*

### Fokus
Masalah matching anomali metal-loss antar dua epoch inspeksi dalam segmen yang dibatasi girth weld.

### Algoritma yang digunakan
- **Monotonic ordered assignment** — modifikasi Hungarian algorithm yang menjaga urutan fisik sepanjang sumbu pipa
- **Cost function multi-dimensional** — jarak ke upstream GW, clock position, panjang defek, lebar defek
- **Fenwick-tree sparse solver** — O(E log M) untuk segmen besar (>250.000 cell)
- **Conservation audit** — setiap baris sumber muncul tepat satu kali di output

### Kontribusi unik
Constraint monotonisitas pada assignment problem jarang dibahas di literatur operations research. Conservation audit memberikan framework verifikasi formal yang memastikan tidak ada data yang hilang atau terduplikasi.

### Cocok untuk
- S2 Matematika Terapan / Operations Research
- Metode riset: Formal — bukti correctness + benchmark komputasi

### Evaluasi
| Kriteria | Nilai |
|---|---|
| Novelty | Moderat-tinggi (75%) |
| Feasibility | Tinggi (85%) |
| Implementasi | Sudah lengkap |
| Data validasi | Tersedia |
| Gap literatur | Moderat |
| Target selesai | < 1 tahun |
| Potensi publikasi | Tinggi |

---

## Opsi 3 — Evidence-Driven Decision Support System

**Judul:**
*"Evidence-Driven Decision Support Framework for Auditable Pipeline Integrity Alignment with Configurable Quality Gates"*

### Fokus
Bagaimana merancang sistem decision-support yang membuat ketidakpastian alignment **terlihat** alih-alih menyembunyikannya.

### Komponen yang diteliti
- **Quality gates** — geometry gate, local scale range, offset baseline shift
- **Contract-based validation** — setiap keputusan alignment memiliki jejak evidence yang auditable
- **Tiga jalur keputusan** — auto-accept, review sign-off, manual override
- **Compliance mapping** — regulasi pipeline Indonesia
- **Wizard-based workflow** — guided alignment process untuk engineer

### Kontribusi unik
Mayoritas tool alignment komersial bersifat black-box. Framework ini menjadikan setiap threshold dan keputusan transparan dan auditable.

### Cocok untuk
- S2 Teknik Industri / Sistem Informasi
- Metode riset: Case study — validasi dengan data lapangan

### Evaluasi
| Kriteria | Nilai |
|---|---|
| Novelty | Moderat (60%) |
| Feasibility | Sangat tinggi (95%) |
| Implementasi | Sudah lengkap |
| Data validasi | Tersedia |
| Gap literatur | Kecil |
| Target selesai | < 1 tahun |
| Potensi publikasi | Moderat |

---

## Opsi 4 — Multi-Epoch Phylogenetic Alignment

**Judul:**
*"Multi-Epoch Phylogenetic Alignment Framework for Longitudinal Pipeline Corrosion Growth Tracking Using Canonical Anchor Graphs"*

### Fokus
Ekstensi dari pairwise alignment ke multi-epoch alignment menggunakan konsep filogenesis.

### Konsep inti
- **Canonical anchor graph** dari 3+ run ILI yang dilakukan bertahun-tahun terpisah
- Setiap node mewakili fitur fisik yang sama terdeteksi di berbagai epoch
- Tracking pertumbuhan korosi jangka panjang
- Prediksi remaining life berdasarkan growth trajectory

### Kontribusi unik
Seluruh literatur alignment ILI fokus pada perbandingan dua run. Multi-epoch alignment adalah masalah terbuka yang belum ada solusi standarnya.

### Cocok untuk
- S2/S3 Teknik Mesin / Computer Science
- Metode riset: Eksperimental + simulasi sintetis

### Evaluasi
| Kriteria | Nilai |
|---|---|
| Novelty | Sangat tinggi (95%) |
| Feasibility | Moderat-rendah (55%) |
| Implementasi | Sebagian |
| Data validasi | Perlu 3+ run |
| Gap literatur | Besar |
| Target selesai | > 1 tahun |
| Potensi publikasi | Sangat tinggi |

---

## Matriks Perbandingan

| Kriteria | 01 Hierarkis | 02 Hungarian | 03 DSS | 04 Phylo |
|---|---|---|---|---|
| Implementasi sudah ada | Lengkap | Lengkap | Lengkap | Sebagian |
| Data validasi tersedia | Ya | Ya | Ya | Perlu 3+ run |
| Gap di literatur | Signifikan | Moderat | Kecil | Besar |
| Bisa selesai < 1 tahun | Ya | Ya | Ya | Tidak |
| Potensi publikasi jurnal | Tinggi | Tinggi | Moderat | Sangat tinggi |

---

## Rekomendasi

**Opsi 01** adalah sweet spot — novelty tinggi, implementasi sudah lengkap, dan gap literatur jelas.

Untuk memperkuat, gabungkan **01 + 02** sebagai satu tesis end-to-end:
> TIE-IN → DTW → Hungarian sebagai pipeline tiga fase

Ini memberikan kontribusi di tiga level sekaligus:
1. **Kalibrasi spasial** (ordered anchor DP + piecewise-linear transform)
2. **Matching struktural** (modified DTW pada girth weld sequence)
3. **Matching anomali** (monotonic Hungarian assignment)

---

## Langkah Selanjutnya

### 1. Literature review
Cari paper dengan keyword:
- "ILI data alignment"
- "pig run comparison"
- "pipeline feature matching"
- "DTW pipeline inspection"
- "in-line inspection data fusion"
- "pipeline corrosion growth assessment"

### 2. Dataset validasi
Siapkan minimal 3 pasang dataset ILI:
- Partial overlap (TIE-IN case)
- Full overlap (standard case)
- Multi-epoch (jika memungkinkan)
- Dengan ground truth dari engineer yang sudah melakukan alignment manual

### 3. Metrik evaluasi
- **Precision/Recall** matching GW
- **RMSE** koordinat transform (TIE-IN accuracy)
- **F1-score** anomaly matching
- **Waktu komputasi** vs alignment manual
- **Conservation rate** (persentase data yang terjaga integritas)

### 4. Baseline comparison
Bandingkan dengan:
1. Naive linear offset (single scale factor)
2. DTW tanpa TIE-IN (direct matching)
3. Manual alignment oleh engineer (ground truth)
4. Vendor tool (jika tersedia data perbandingan)

### 5. Struktur bab (draft)

```
BAB 1 — Pendahuluan
  1.1 Latar belakang
  1.2 Rumusan masalah
  1.3 Tujuan penelitian
  1.4 Batasan masalah
  1.5 Sistematika penulisan

BAB 2 — Tinjauan Pustaka
  2.1 Pipeline integrity management
  2.2 In-Line Inspection (ILI) technology
  2.3 Sequence alignment algorithms (DTW, Hungarian)
  2.4 Robust regression (Theil-Sen, IRLS)
  2.5 Penelitian terkait

BAB 3 — Metodologi
  3.1 Arsitektur pipeline alignment hierarkis
  3.2 Fase 0: Ordered anchor spatial calibration
  3.3 Fase 1: Modified DTW untuk girth weld matching
  3.4 Fase 2: Monotonic Hungarian untuk anomaly matching
  3.5 Quality gates dan engineering constraints
  3.6 Desain eksperimen

BAB 4 — Implementasi dan Pengujian
  4.1 Implementasi sistem
  4.2 Dataset dan preprocessing
  4.3 Hasil eksperimen
  4.4 Analisis perbandingan dengan baseline
  4.5 Validasi dengan ground truth

BAB 5 — Kesimpulan dan Saran
  5.1 Kesimpulan
  5.2 Saran pengembangan
```

---

*Dihasilkan dari analisis codebase Synapse PHM — kerangka ide, bukan proposal final.*

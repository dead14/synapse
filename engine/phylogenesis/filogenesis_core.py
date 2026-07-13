"""
filogenesis_core.py — Inti Algoritma Filogenesis ILI Alignment
==============================================================
Berisi implementasi murni (pure functions) untuk:
- RANSAC Ancestral Sanitization (Fase 1)
- Confidence Decay & Weighting (Fase 2)
- Block Partitioning (Fase 3)
- Anchor-Constrained DTW (Fase 4)
- Hungarian Matching dengan Prior (Fase 5)
- Canonical Update & Graph Rebase (Fase 6)
- Validasi Fisik Otomatis (Fase 7)

Semua fungsi pure, bisa di-unit test tanpa database.
"""

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial.distance import cdist
from typing import List, Tuple, Dict, Optional, Any
from dataclasses import dataclass, field
import math
import logging

logger = logging.getLogger("phylogenesis")

# ===========================================================================
# DATA CLASSES
# ===========================================================================

@dataclass
class AncestralAnchor:
    """Representasi satu anchor dari rantai leluhur (ancestor chain)."""
    canonical_id: int
    odom_source: float        # odometer pada source run
    abs_chainage: float       # koordinat master pipeline
    sigma: float              # ketidakpastian (meter)
    confidence: float         # 0..1
    is_golden: bool           # validasi manual / tally book
    anchor_type: str          # GW, TEE, VALVE, dll
    link_confidence: float = 1.0  # confidence dari alignment_link
    generation_age: float = 0.0   # umur generasi (tahun)


@dataclass
class Feature:
    """Representasi satu fitur ILI."""
    id: int
    ili_run_id: int
    feature_type: str   # GW, TEE, VALVE, SLEEVE, METAL_LOSS
    odometer: float
    metadata: dict = field(default_factory=dict)


@dataclass
class MatchResult:
    """Hasil matching satu pasang fitur."""
    source_feature_id: int
    target_feature_id: int
    abs_chainage: float
    confidence: float
    method: str              # 'dtw_hungarian', 'fallback_dtw', 'golden_match'
    warped_distance: float = 0.0


@dataclass
class BlockResult:
    """Hasil pemrosesan satu blok pipeline."""
    block_idx: int
    start_abs: float
    end_abs: float
    matches: List[MatchResult]
    warping_path: List[Tuple[int, int]]
    is_corrupt: bool = False
    need_manual_review: bool = False
    mean_dtw_cost: float = 0.0
    is_suspect_spool: bool = False


@dataclass
class AlignmentReport:
    """Laporan lengkap hasil alignment filogenesis."""
    job_id: int
    ransac_inliers: int = 0
    ransac_outliers: int = 0
    total_blocks: int = 0
    fallback_blocks: int = 0
    corrupt_blocks: int = 0
    suspect_spool_blocks: int = 0
    joint_violations: int = 0
    total_matches: int = 0
    physically_impossible_joints: List[dict] = field(default_factory=list)
    block_results: List[BlockResult] = field(default_factory=list)
    outlier_anchors: List[int] = field(default_factory=list)  # canonical_ids


# ===========================================================================
# FASE 1: RANSAC ANCESTRAL SANITIZATION
# ===========================================================================

def ransac_linear_fit(
    anchors: List[AncestralAnchor],
    n_iters: int = 150,
    tolerance: float = 0.6,
    scale_min: float = 0.95,
    scale_max: float = 1.05,
    rng_seed: Optional[int] = None
) -> Tuple[List[AncestralAnchor], List[AncestralAnchor], float, float]:
    """
    RANSAC linear fitting untuk sanitasi anchor leluhur.
    
    Model: abs_chainage = scale * odom_source + offset
    
    Menolak anchor yang secara statistik tidak konsisten dengan
    model linear (kemungkinan error odometer historis, salah link, dll).
    
    Parameter:
        anchors: Daftar anchor mentah dari ancestor chain
        n_iters: Jumlah iterasi RANSAC (default 150)
        tolerance: Toleransi residual untuk inlier (meter, default 0.6)
        scale_min: Batas bawah scale yang diterima (default 0.95)
        scale_max: Batas atas scale yang diterima (default 1.05)
        rng_seed: Seed untuk reproducibility (opsional)
    
    Return:
        (inliers, outliers, best_scale, best_offset)
    """
    if len(anchors) < 2:
        logger.warning("RANSAC: Terlalu sedikit anchor (%d), skip sanitasi", len(anchors))
        return anchors, [], 1.0, 0.0

    rng = np.random.RandomState(rng_seed)
    
    odoms = np.array([a.odom_source for a in anchors])
    chainages = np.array([a.abs_chainage for a in anchors])

    best_inlier_count = 0
    best_scale = 1.0
    best_offset = 0.0
    best_inlier_mask = np.ones(len(anchors), dtype=bool)

    for _ in range(n_iters):
        # Ambil 2 anchor random
        idx = rng.choice(len(anchors), size=2, replace=False)
        o1, o2 = odoms[idx[0]], odoms[idx[1]]
        c1, c2 = chainages[idx[0]], chainages[idx[1]]

        # Hindari pembagian nol
        if abs(o2 - o1) < 1e-6:
            continue

        # Hitung scale & offset
        scale = (c2 - c1) / (o2 - o1)
        offset = c1 - scale * o1

        # Reject scale di luar batas wajar
        if scale < scale_min or scale > scale_max:
            continue

        # Hitung residual
        predicted = scale * odoms + offset
        residuals = np.abs(chainages - predicted)
        inlier_mask = residuals < tolerance
        inlier_count = np.sum(inlier_mask)

        if inlier_count > best_inlier_count:
            best_inlier_count = inlier_count
            best_scale = scale
            best_offset = offset
            best_inlier_mask = inlier_mask

    # Pisahkan inliers dan outliers
    inliers = [a for a, m in zip(anchors, best_inlier_mask) if m]
    outliers = [a for a, m in zip(anchors, best_inlier_mask) if not m]

    logger.info(
        "RANSAC selesai: %d inliers, %d outliers (scale=%.4f, offset=%.2f)",
        len(inliers), len(outliers), best_scale, best_offset
    )

    return inliers, outliers, best_scale, best_offset


# ===========================================================================
# FASE 2: CONFIDENCE DECAY & WEIGHTING
# ===========================================================================

def compute_anchor_weights(
    anchors: List[AncestralAnchor],
    decay_rate: float = 0.2,
    drift_rate: float = 0.1,
    golden_multiplier: float = 3.0,
    sigma_floor: float = 0.1
) -> List[Tuple[AncestralAnchor, float, float]]:
    """
    Hitung weight dan sigma baru untuk setiap anchor berdasarkan
    confidence decay dan propagasi ketidakpastian.
    
    Formula:
        sigma_baru = sqrt(sigma_canonical^2 + sigma_source_link^2 + drift_penalty^2)
        drift_penalty = drift_rate * umur_generasi_tahun
        weight = confidence * exp(-decay_rate * umur_generasi) / (sigma_baru + sigma_floor)
        Jika is_golden: weight *= golden_multiplier
    
    Parameter:
        anchors: Daftar anchor yang sudah lolos RANSAC
        decay_rate: Laju peluruhan confidence per tahun (default 0.2)
        drift_rate: Drift odometer per tahun (meter, default 0.1)
        golden_multiplier: Pengali weight untuk golden anchor (default 3.0)
        sigma_floor: Batas bawah denominator weight (default 0.1)
    
    Return:
        List of (anchor, weight, sigma_baru)
    """
    results = []

    for anchor in anchors:
        drift_penalty = drift_rate * anchor.generation_age
        
        sigma_canonical = anchor.sigma
        sigma_link = max(1.0 - anchor.link_confidence, 0.05)  # konversi confidence link ke sigma
        
        sigma_baru = math.sqrt(
            sigma_canonical ** 2 + 
            sigma_link ** 2 + 
            drift_penalty ** 2
        )
        
        weight = (
            anchor.confidence * 
            math.exp(-decay_rate * anchor.generation_age) / 
            (sigma_baru + sigma_floor)
        )
        
        if anchor.is_golden:
            weight *= golden_multiplier
        
        results.append((anchor, weight, sigma_baru))

    logger.info(
        "Computed weights untuk %d anchors. Golden count: %d",
        len(results),
        sum(1 for a in anchors if a.is_golden)
    )

    return results


# ===========================================================================
# FASE 3: BLOCK PARTITIONING
# ===========================================================================

def partition_into_blocks(
    weighted_anchors: List[Tuple[AncestralAnchor, float, float]],
    min_block_size: float = 500.0,
    max_block_size: float = 1000.0
) -> List[Dict[str, Any]]:
    """
    Bagi pipeline menjadi blok-blok berdasarkan golden anchor.
    
    Setiap blok diproses independen untuk mencegah propagasi error.
    Batas blok dipilih pada posisi golden anchor (GW, TEE, VALVE
    yang sudah terverifikasi manual).
    
    Parameter:
        weighted_anchors: Output dari compute_anchor_weights
        min_block_size: Ukuran minimum blok (meter, default 500)
        max_block_size: Ukuran maksimum blok (meter, default 1000)
    
    Return:
        List of dicts: [{start_abs, end_abs, anchors: [(anchor, weight, sigma)]}]
    """
    if not weighted_anchors:
        return []

    # Sort berdasarkan abs_chainage
    sorted_anchors = sorted(weighted_anchors, key=lambda x: x[0].abs_chainage)
    
    # Kumpulkan golden anchors sebagai kandidat batas blok
    golden_positions = [
        a[0].abs_chainage for a in sorted_anchors if a[0].is_golden
    ]
    
    pipeline_start = sorted_anchors[0][0].abs_chainage
    pipeline_end = sorted_anchors[-1][0].abs_chainage

    # Buat batas blok
    boundaries = [pipeline_start]
    
    if golden_positions:
        for pos in sorted(golden_positions):
            last_boundary = boundaries[-1]
            dist_from_last = pos - last_boundary
            
            if dist_from_last >= min_block_size:
                boundaries.append(pos)
            elif dist_from_last > max_block_size:
                # Paksa split meskipun bukan di golden anchor
                n_splits = int(dist_from_last / max_block_size)
                step = dist_from_last / (n_splits + 1)
                for j in range(1, n_splits + 1):
                    boundaries.append(last_boundary + step * j)
                boundaries.append(pos)
    
    # Pastikan pipeline_end termasuk
    if boundaries[-1] < pipeline_end:
        boundaries.append(pipeline_end + 0.1)  # sedikit buffer

    # Bagi anchor ke blok
    blocks = []
    for i in range(len(boundaries) - 1):
        start = boundaries[i]
        end = boundaries[i + 1]
        
        block_anchors = [
            (a, w, s) for a, w, s in sorted_anchors
            if a.abs_chainage >= start and a.abs_chainage < end
        ]
        # Inklusif untuk blok terakhir
        if i == len(boundaries) - 2:
            block_anchors = [
                (a, w, s) for a, w, s in sorted_anchors
                if a.abs_chainage >= start and a.abs_chainage <= end
            ]
        
        if block_anchors:  # skip blok kosong
            blocks.append({
                'start_abs': start,
                'end_abs': end,
                'anchors': block_anchors
            })

    logger.info(
        "Pipeline dibagi menjadi %d blok (%.1fm - %.1fm)",
        len(blocks), pipeline_start, pipeline_end
    )

    return blocks


# ===========================================================================
# FASE 4: ANCHOR-CONSTRAINED DTW (Implementasi Sendiri)
# ===========================================================================

def _compute_cost_matrix(
    signal_source: np.ndarray,
    signal_target: np.ndarray
) -> np.ndarray:
    """
    Hitung cost matrix euclidean antara dua sinyal 1D.
    
    Parameter:
        signal_source: Sinyal MFL source (1D array)
        signal_target: Sinyal MFL target (1D array)
    
    Return:
        Cost matrix shape (len_source, len_target)
    """
    s = signal_source.reshape(-1, 1)
    t = signal_target.reshape(-1, 1)
    return cdist(s, t, metric='euclidean')


def _build_constraint_mask(
    n_source: int,
    n_target: int,
    anchor_constraints: List[Tuple[int, int, float]],
    sampling_interval: float = 0.1
) -> np.ndarray:
    """
    Bangun constraint mask untuk DTW.
    
    Mask bernilai INF di mana-mana, kecuali di sekitar anchor
    constraints yang bernilai 0.
    
    Parameter:
        n_source: Panjang sinyal source
        n_target: Panjang sinyal target
        anchor_constraints: List of (source_idx, target_idx_estimate, sigma_baru)
        sampling_interval: Interval sampling sinyal (meter, default 0.1)
    
    Return:
        Mask matrix shape (n_source, n_target)
    """
    mask = np.full((n_source, n_target), np.inf)
    
    for src_idx, tgt_idx_est, sigma in anchor_constraints:
        window = max(20, int(sigma * 10 / sampling_interval))
        
        i_start = max(0, src_idx - window)
        i_end = min(n_source, src_idx + window)
        
        j_start = max(0, int(tgt_idx_est) - window)
        j_end = min(n_target, int(tgt_idx_est) + window)
        
        mask[i_start:i_end, j_start:j_end] = 0.0
    
    return mask


def dtw_constrained(
    cost_matrix: np.ndarray,
    constraint_mask: Optional[np.ndarray] = None,
    sakoe_chiba_band: Optional[int] = None
) -> Tuple[List[Tuple[int, int]], float]:
    """
    Dynamic Time Warping dengan constraint mask dan Sakoe-Chiba band.
    
    Implementasi dari nol (bukan library blackbox) agar bisa menerima
    constraint mask yang memaksa warping path melewati area tertentu.
    
    Parameter:
        cost_matrix: Matrix biaya (n_source x n_target)
        constraint_mask: Matrix INF/0 untuk constraint area (opsional)
        sakoe_chiba_band: Lebar band Sakoe-Chiba (opsional, default None = full)
    
    Return:
        (warping_path, total_cost)
        warping_path: List of (i, j) tuples
        total_cost: Total biaya akumulatif path
    """
    n, m = cost_matrix.shape
    
    # Gabungkan cost dengan constraint mask
    if constraint_mask is not None:
        # Mask hanya menambah cost di area yang TIDAK di-constraint
        # Area constraint (mask=0) tidak menambah biaya
        # Area non-constraint (mask=INF) menambah penalty besar
        combined = cost_matrix + constraint_mask
    else:
        combined = cost_matrix.copy()
    
    # Inisialisasi DTW accumulated cost matrix
    D = np.full((n + 1, m + 1), np.inf)
    D[0, 0] = 0.0

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            # Sakoe-Chiba band check
            if sakoe_chiba_band is not None:
                if abs(i * m / n - j) > sakoe_chiba_band:
                    continue
            
            cost = combined[i - 1, j - 1]
            D[i, j] = cost + min(
                D[i - 1, j],        # insertion
                D[i, j - 1],        # deletion
                D[i - 1, j - 1]     # match
            )

    # Backtrack untuk dapat warping path
    path = []
    i, j = n, m
    
    if np.isinf(D[i, j]):
        # Tidak ada path valid
        return [], float('inf')
    
    while i > 0 or j > 0:
        path.append((i - 1, j - 1))
        
        if i == 0:
            j -= 1
        elif j == 0:
            i -= 1
        else:
            candidates = [
                (D[i - 1, j - 1], i - 1, j - 1),
                (D[i - 1, j], i - 1, j),
                (D[i, j - 1], i, j - 1)
            ]
            _, i, j = min(candidates, key=lambda x: x[0])
    
    path.reverse()
    total_cost = D[n, m]

    return path, total_cost


def process_block_dtw(
    signal_source_block: np.ndarray,
    signal_target_block: np.ndarray,
    anchor_constraints: List[Tuple[int, int, float]],
    sampling_interval: float = 0.1,
    sakoe_chiba_band: Optional[int] = None
) -> Tuple[List[Tuple[int, int]], float, bool, bool]:
    """
    Proses DTW untuk satu blok pipeline dengan constraint dari anchor.
    
    Mencoba DTW constrained dulu. Jika gagal (CORRUPT), fallback
    ke DTW murni tanpa mask.
    
    Parameter:
        signal_source_block: Sinyal MFL source untuk blok ini
        signal_target_block: Sinyal MFL target untuk blok ini
        anchor_constraints: [(source_idx, target_idx_est, sigma)]
        sampling_interval: Interval sampling (meter)
        sakoe_chiba_band: Lebar Sakoe-Chiba band
    
    Return:
        (warping_path, cost, is_corrupt, need_manual_review)
    """
    cost_matrix = _compute_cost_matrix(signal_source_block, signal_target_block)
    
    # Coba DTW constrained
    if anchor_constraints:
        mask = _build_constraint_mask(
            len(signal_source_block),
            len(signal_target_block),
            anchor_constraints,
            sampling_interval
        )
        path, cost = dtw_constrained(cost_matrix, mask, sakoe_chiba_band)
        
        if path:
            logger.info("DTW constrained berhasil, cost=%.2f", cost)
            return path, cost, False, False
        
        # CORRUPT: fallback ke DTW murni
        logger.warning("DTW constrained GAGAL (CORRUPT block), fallback ke DTW murni")
    
    # Fallback: DTW tanpa mask
    path, cost = dtw_constrained(cost_matrix, None, sakoe_chiba_band)
    
    if path:
        return path, cost, True, True
    
    # Total failure
    logger.error("DTW total failure untuk blok ini")
    return [], float('inf'), True, True


# ===========================================================================
# FASE 5: HUNGARIAN MATCHING DENGAN PRIOR
# ===========================================================================

def hungarian_matching_with_prior(
    features_source: List[Feature],
    features_target: List[Feature],
    warping_path: List[Tuple[int, int]],
    weighted_anchors: List[Tuple[AncestralAnchor, float, float]],
    source_odom_start: float,
    target_odom_start: float,
    sampling_interval: float = 0.1,
    alpha: float = 1.0,
    beta: float = 100.0,
    gamma: float = 0.5,
    max_warped_distance: float = 1.5
) -> List[MatchResult]:
    """
    Hungarian matching dengan prior dari DTW warping path dan ancestor weights.
    
    Cost matrix:
        cost = alpha * odom_distance_warped 
             + beta * feature_type_penalty 
             + gamma * (1 / weight_ancestor_terdekat)
    
    Jika feature_type beda (misal GW vs METAL_LOSS): penalty = INF
    Match yang jaraknya > max_warped_distance dari proyeksi DTW: REJECT
    
    Parameter:
        features_source: Fitur-fitur pada source run
        features_target: Fitur-fitur pada target run  
        warping_path: Path dari DTW constrained
        weighted_anchors: Anchor beserta weight-nya
        source_odom_start: Odometer awal blok source
        target_odom_start: Odometer awal blok target
        sampling_interval: Interval sampling sinyal
        alpha: Bobot jarak warped
        beta: Bobot penalty tipe fitur beda (harus besar / INF)
        gamma: Bobot inverse weight ancestor
        max_warped_distance: Jarak maksimum setelah warp untuk accept (meter)
    
    Return:
        List of MatchResult yang lolos filter
    """
    if not features_source or not features_target or not warping_path:
        return []

    # Bangun lookup warping: source_idx -> target_idx
    warp_map = {}
    for s_idx, t_idx in warping_path:
        if s_idx not in warp_map:
            warp_map[s_idx] = t_idx
    
    n_src = len(features_source)
    n_tgt = len(features_target)
    
    # Bangun cost matrix
    cost = np.full((n_src, n_tgt), 1e12)
    
    for i, fs in enumerate(features_source):
        # Konversi odometer source ke index sinyal
        src_signal_idx = int((fs.odometer - source_odom_start) / sampling_interval)
        src_signal_idx = max(0, min(src_signal_idx, max(warp_map.keys()) if warp_map else 0))
        
        # Proyeksikan ke target via warping path
        projected_tgt_idx = warp_map.get(src_signal_idx, src_signal_idx)
        projected_tgt_odom = target_odom_start + projected_tgt_idx * sampling_interval
        
        for j, ft in enumerate(features_target):
            # Penalty tipe fitur
            if fs.feature_type != ft.feature_type:
                cost[i, j] = 1e12  # INF equivalent
                continue
            
            # Jarak setelah warping
            warped_dist = abs(ft.odometer - projected_tgt_odom)
            
            if warped_dist > max_warped_distance:
                cost[i, j] = 1e12
                continue
            
            # Cari weight ancestor terdekat
            closest_weight = 0.1  # default minimum
            if weighted_anchors:
                min_anchor_dist = float('inf')
                for anchor, weight, sigma in weighted_anchors:
                    d = abs(anchor.abs_chainage - fs.odometer)
                    if d < min_anchor_dist:
                        min_anchor_dist = d
                        closest_weight = max(weight, 0.01)
            
            cost[i, j] = (
                alpha * warped_dist +
                gamma * (1.0 / closest_weight)
            )
    
    # Hungarian assignment
    try:
        row_indices, col_indices = linear_sum_assignment(cost)
    except ValueError:
        logger.error("Hungarian assignment gagal")
        return []
    
    # Filter match yang valid
    matches = []
    for r, c in zip(row_indices, col_indices):
        if cost[r, c] >= 1e11:
            continue  # skip INF cost matches
        
        fs = features_source[r]
        ft = features_target[c]
        
        # Hitung abs_chainage untuk match ini
        # Gunakan weighted average jika ada anchor terdekat
        abs_chain = fs.odometer  # fallback
        conf = 0.5
        
        if weighted_anchors:
            # Cari anchor terdekat untuk interpolasi
            min_d = float('inf')
            for anchor, weight, sigma in weighted_anchors:
                d = abs(anchor.odom_source - fs.odometer)
                if d < min_d:
                    min_d = d
                    abs_chain = anchor.abs_chainage + (fs.odometer - anchor.odom_source)
                    conf = min(0.95, anchor.confidence * 0.9)
        
        # Hitung projected warped distance untuk confidence
        src_idx = int((fs.odometer - source_odom_start) / sampling_interval)
        src_idx = max(0, min(src_idx, max(warp_map.keys()) if warp_map else 0))
        proj_tgt_idx = warp_map.get(src_idx, src_idx)
        proj_tgt_odom = target_odom_start + proj_tgt_idx * sampling_interval
        warped_d = abs(ft.odometer - proj_tgt_odom)
        
        matches.append(MatchResult(
            source_feature_id=fs.id,
            target_feature_id=ft.id,
            abs_chainage=abs_chain,
            confidence=conf * max(0, 1 - warped_d / max_warped_distance),
            method='dtw_hungarian',
            warped_distance=warped_d
        ))
    
    logger.info(
        "Hungarian matching: %d/%d source fitur matched",
        len(matches), n_src
    )

    return matches


# ===========================================================================
# FASE 6: CANONICAL UPDATE (Kalman-like)
# ===========================================================================

def kalman_update_chainage(
    abs_old: float,
    sigma_old: float,
    abs_new: float,
    sigma_new: float
) -> Tuple[float, float]:
    """
    Kalman-like update untuk menggabungkan estimasi lama dan baru.
    
    Formula:
        abs_updated = (abs_old/sigma_old^2 + abs_new/sigma_new^2) / (1/sigma_old^2 + 1/sigma_new^2)
        sigma_updated = 1 / sqrt(1/sigma_old^2 + 1/sigma_new^2)
    
    Parameter:
        abs_old: Estimasi abs_chainage lama
        sigma_old: Sigma lama
        abs_new: Estimasi abs_chainage baru
        sigma_new: Sigma baru
    
    Return:
        (abs_updated, sigma_updated)
    """
    # Hindari pembagian nol
    sigma_old = max(sigma_old, 0.01)
    sigma_new = max(sigma_new, 0.01)
    
    precision_old = 1.0 / (sigma_old ** 2)
    precision_new = 1.0 / (sigma_new ** 2)
    
    precision_total = precision_old + precision_new
    
    abs_updated = (abs_old * precision_old + abs_new * precision_new) / precision_total
    sigma_updated = 1.0 / math.sqrt(precision_total)
    
    return abs_updated, sigma_updated


def compute_canonical_updates(
    matches: List[MatchResult],
    features_target: List[Feature],
    warping_path: List[Tuple[int, int]],
    weighted_anchors: List[Tuple[AncestralAnchor, float, float]],
    existing_canonicals: Optional[Dict[int, Tuple[float, float]]] = None
) -> List[Dict[str, Any]]:
    """
    Hitung canonical updates untuk semua match yang lolos.
    
    Untuk match yang canonicalnya sudah ada, gunakan Kalman update.
    Untuk match baru, buat canonical baru.
    
    Parameter:
        matches: Hasil Hungarian matching
        features_target: Fitur target
        warping_path: DTW warping path
        weighted_anchors: Anchor dengan weight
        existing_canonicals: Dict {feature_id: (abs_chainage, sigma)} jika ada
    
    Return:
        List of dicts dengan info update canonical
    """
    if existing_canonicals is None:
        existing_canonicals = {}
    
    updates = []
    
    for match in matches:
        target_feat = None
        for f in features_target:
            if f.id == match.target_feature_id:
                target_feat = f
                break
        
        if target_feat is None:
            continue
        
        # Hitung sigma baru untuk match ini
        sigma_new = max(0.3, 1.0 - match.confidence)
        
        if match.target_feature_id in existing_canonicals:
            # Kalman update
            abs_old, sigma_old = existing_canonicals[match.target_feature_id]
            abs_updated, sigma_updated = kalman_update_chainage(
                abs_old, sigma_old, match.abs_chainage, sigma_new
            )
            updates.append({
                'action': 'UPDATE',
                'target_feature_id': match.target_feature_id,
                'abs_chainage': abs_updated,
                'sigma': sigma_updated,
                'confidence': match.confidence,
                'anchor_type': target_feat.feature_type,
                'method': match.method
            })
        else:
            # Canonical baru
            updates.append({
                'action': 'INSERT',
                'target_feature_id': match.target_feature_id,
                'abs_chainage': match.abs_chainage,
                'sigma': sigma_new,
                'confidence': match.confidence,
                'anchor_type': target_feat.feature_type,
                'method': match.method
            })
    
    logger.info(
        "Canonical updates: %d INSERT, %d UPDATE",
        sum(1 for u in updates if u['action'] == 'INSERT'),
        sum(1 for u in updates if u['action'] == 'UPDATE')
    )
    
    return updates


# ===========================================================================
# FASE 7: VALIDASI FISIK OTOMATIS
# ===========================================================================

def validate_physical_constraints(
    canonical_anchors_sorted: List[Dict[str, Any]],
    block_results: List[BlockResult],
    min_joint_length: float = 10.5,
    max_joint_length: float = 13.5,
    suspect_cost_multiplier: float = 2.5
) -> Tuple[List[Dict[str, Any]], List[int]]:
    """
    Validasi fisik otomatis setelah semua blok selesai.
    
    Cek 1: Joint length harus antara min_joint_length dan max_joint_length
           untuk anchor tipe GW.
    Cek 2: Jika mean DTW cost blok > 2.5x mean global, flag sebagai
           SUSPECT_SPOOL_REPLACEMENT.
    
    Parameter:
        canonical_anchors_sorted: List anchor canonical terurut berdasarkan abs_chainage
        block_results: Hasil dari semua blok
        min_joint_length: Panjang joint minimum (meter, default 10.5)
        max_joint_length: Panjang joint maksimum (meter, default 13.5)
        suspect_cost_multiplier: Multiplier untuk deteksi spool replacement (default 2.5)
    
    Return:
        (violations, suspect_block_indices)
        violations: List dicts {index, chainage_i, chainage_j, joint_length, type}
        suspect_block_indices: Indeks blok yang dicurigai spool replacement
    """
    violations = []
    
    # Cek 1: Joint length violations
    gw_anchors = [a for a in canonical_anchors_sorted if a.get('anchor_type') == 'GW']
    gw_anchors.sort(key=lambda x: x['abs_chainage'])
    
    for i in range(len(gw_anchors) - 1):
        joint_length = gw_anchors[i + 1]['abs_chainage'] - gw_anchors[i]['abs_chainage']
        
        if joint_length < min_joint_length or joint_length > max_joint_length:
            violations.append({
                'index': i,
                'chainage_i': gw_anchors[i]['abs_chainage'],
                'chainage_j': gw_anchors[i + 1]['abs_chainage'],
                'joint_length': joint_length,
                'type': 'PHYSICALLY_IMPOSSIBLE'
            })
    
    # Cek 2: Suspect spool replacement
    suspect_blocks = []
    valid_costs = [br.mean_dtw_cost for br in block_results if br.mean_dtw_cost > 0 and not br.is_corrupt]
    
    if valid_costs:
        mean_global_cost = np.mean(valid_costs)
        
        for br in block_results:
            if br.mean_dtw_cost > suspect_cost_multiplier * mean_global_cost and not br.is_corrupt:
                br.is_suspect_spool = True
                suspect_blocks.append(br.block_idx)
                logger.warning(
                    "Block %d (%.1fm-%.1fm) SUSPECT SPOOL REPLACEMENT: cost=%.2f vs global=%.2f",
                    br.block_idx, br.start_abs, br.end_abs,
                    br.mean_dtw_cost, mean_global_cost
                )
    
    logger.info(
        "Validasi fisik: %d joint violations, %d suspect blocks",
        len(violations), len(suspect_blocks)
    )
    
    return violations, suspect_blocks

"""
filogenesis_core.py — Core algorithms for phylogenetic ILI alignment
====================================================================
Pure implementations of:
- RANSAC ancestral sanitization (phase 1)
- Confidence decay & weighting (phase 2)
- Block partitioning (phase 3)
- Anchor-constrained DTW (phase 4)
- Hungarian matching with prior (phase 5)
- Canonical update & graph rebase (phase 6)
- Automatic physical validation (phase 7)

Every function is pure and unit-testable without a database.
"""

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial.distance import cdist
from typing import Callable, List, Tuple, Dict, Optional, Any
from dataclasses import dataclass, field
import math
import logging
import os

logger = logging.getLogger("phylogenesis")

# ===========================================================================
# RESOLUTION AND BAND CONFIGURATION
# ===========================================================================
# The alignment signals are resampled odometer axes.  At the native 0.1 m step
# a 4 km run is 40_000 samples, and a full 40_000 x 40_000 float64 DP grid is
# 12.8 GB — per matrix.  Nothing here may ever allocate an n*m array: the DP
# runs inside a band and costs are produced per row on the fly.

DEFAULT_SAMPLING_INTERVAL_M = 0.1

# Hard cap on samples per signal.  Above it the sampling step is coarsened
# proportionally, trading sub-sample odometer resolution for a DP that fits in
# memory.  At 20_000 samples a 4 km run resolves to 0.2 m, which is still finer
# than the +/-0.3 m odometer repeatability of the tools being compared.
MAX_SIGNAL_SAMPLES = int(os.getenv("PHYLO_MAX_SIGNAL_SAMPLES", "20000"))

# Sakoe-Chiba radius (in samples) used when a signal pair is too large to run
# unbanded.  512 samples is 51 m at the native step; anchor windows are an
# order of magnitude tighter than that, so the band never clips a plausible
# warping path.
DTW_BAND_RADIUS_SAMPLES = int(os.getenv("PHYLO_DTW_BAND_RADIUS_SAMPLES", "512"))

# Below this many cells the DP still spans the full grid (identical results to
# the pre-band implementation); above it the default Sakoe-Chiba radius kicks
# in.  This is a *virtual* cell budget — no array of this size is allocated.
MAX_UNBANDED_DTW_CELLS = int(os.getenv("PHYLO_MAX_UNBANDED_DTW_CELLS", "4000000"))

# Backpointer codes stored per banded cell (int8, one byte per cell).
_MOVE_DIAGONAL = 0
_MOVE_UP = 1
_MOVE_LEFT = 2

# ===========================================================================
# DATA CLASSES
# ===========================================================================

@dataclass
class AncestralAnchor:
    """One anchor from the ancestor chain."""
    canonical_id: int
    odom_source: float        # odometer on the source run
    abs_chainage: float       # master pipeline coordinate
    sigma: float              # uncertainty (metres)
    confidence: float         # 0..1
    is_golden: bool           # manually validated / tally book
    anchor_type: str          # GW, TEE, VALVE, ...
    link_confidence: float = 1.0  # confidence carried by the alignment_link
    generation_age: float = 0.0   # generation age (years)


@dataclass
class Feature:
    """One ILI feature."""
    id: int
    ili_run_id: int
    feature_type: str   # GW, TEE, VALVE, SLEEVE, METAL_LOSS
    odometer: float
    metadata: dict = field(default_factory=dict)


@dataclass
class MatchResult:
    """The match result for one feature pair."""
    source_feature_id: int
    target_feature_id: int
    abs_chainage: float
    confidence: float
    method: str              # 'dtw_hungarian', 'fallback_dtw', 'golden_match'
    warped_distance: float = 0.0


@dataclass
class BlockResult:
    """The processing result for one pipeline block."""
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
    """The full phylogenetic alignment report."""
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
# PHASE 1: RANSAC ANCESTRAL SANITIZATION
# ===========================================================================

def ransac_linear_fit(
    anchors: List[AncestralAnchor],
    n_iters: int = 150,
    tolerance: float = 0.6,
    scale_min: float = 0.95,
    scale_max: float = 1.05,
    rng_seed: Optional[int] = None
) -> Tuple[List[AncestralAnchor], List[AncestralAnchor], float, float, bool]:
    """
    RANSAC linear fit that sanitises the ancestral anchors.

    Model: abs_chainage = scale * odom_source + offset

    Rejects anchors that are statistically inconsistent with the linear model
    (historical odometer errors, mis-linked anchors, and so on).

    Parameters:
        anchors: raw anchors from the ancestor chain
        n_iters: number of RANSAC iterations (default 150)
        tolerance: residual tolerance for an inlier (metres, default 0.6)
        scale_min: lower bound on an acceptable scale (default 0.95)
        scale_max: upper bound on an acceptable scale (default 1.05)
        rng_seed: seed for reproducibility (optional)

    Returns:
        (inliers, outliers, best_scale, best_offset, success)
        success=False means NO sampled hypothesis stayed inside the scale
        bounds [scale_min, scale_max]; inliers and outliers come back empty and
        the caller must treat no anchor as either validated or rejected.
    """
    if len(anchors) < 2:
        logger.warning("RANSAC: too few anchors (%d); skipping sanitization", len(anchors))
        return anchors, [], 1.0, 0.0, True

    rng = np.random.RandomState(rng_seed)
    
    odoms = np.array([a.odom_source for a in anchors])
    chainages = np.array([a.abs_chainage for a in anchors])

    best_inlier_count = 0
    best_scale = 1.0
    best_offset = 0.0
    best_inlier_mask = np.ones(len(anchors), dtype=bool)

    for _ in range(n_iters):
        # Draw two random anchors.
        idx = rng.choice(len(anchors), size=2, replace=False)
        o1, o2 = odoms[idx[0]], odoms[idx[1]]
        c1, c2 = chainages[idx[0]], chainages[idx[1]]

        # Avoid dividing by zero.
        if abs(o2 - o1) < 1e-6:
            continue

        # Derive scale and offset.
        scale = (c2 - c1) / (o2 - o1)
        offset = c1 - scale * o1

        # Reject a scale outside the plausible range.
        if scale < scale_min or scale > scale_max:
            continue

        # Residuals against the hypothesis.
        predicted = scale * odoms + offset
        residuals = np.abs(chainages - predicted)
        inlier_mask = residuals < tolerance
        inlier_count = np.sum(inlier_mask)

        if inlier_count > best_inlier_count:
            best_inlier_count = inlier_count
            best_scale = scale
            best_offset = offset
            best_inlier_mask = inlier_mask

    if best_inlier_count == 0:
        # Every sampled hypothesis fell outside the scale bounds (or was
        # degenerate).  Do not return scale=1/offset=0 with every anchor marked
        # an inlier — that is indistinguishable from a successful fit.
        logger.warning(
            "RANSAC FAILED: no hypothesis had a scale within [%.3f, %.3f] "
            "across %d anchors. The fit result is unusable.",
            scale_min, scale_max, len(anchors)
        )
        return [], [], 1.0, 0.0, False

    # Least-squares refit over the inlier set (the standard RANSAC step) so
    # scale/offset do not depend on the two sampled hypothesis points alone.
    inlier_odoms = odoms[best_inlier_mask]
    inlier_chainages = chainages[best_inlier_mask]
    if len(inlier_odoms) >= 2 and float(np.ptp(inlier_odoms)) > 1e-6:
        refit_scale, refit_offset = np.polyfit(inlier_odoms, inlier_chainages, 1)
        if scale_min <= refit_scale <= scale_max:
            best_scale = float(refit_scale)
            best_offset = float(refit_offset)

    # Split inliers from outliers.
    inliers = [a for a, m in zip(anchors, best_inlier_mask) if m]
    outliers = [a for a, m in zip(anchors, best_inlier_mask) if not m]

    logger.info(
        "RANSAC complete: %d inliers, %d outliers (scale=%.4f, offset=%.2f)",
        len(inliers), len(outliers), best_scale, best_offset
    )

    return inliers, outliers, best_scale, best_offset, True


# ===========================================================================
# PHASE 2: CONFIDENCE DECAY & WEIGHTING
# ===========================================================================

def compute_anchor_weights(
    anchors: List[AncestralAnchor],
    decay_rate: float = 0.2,
    drift_rate: float = 0.1,
    golden_multiplier: float = 3.0,
    sigma_floor: float = 0.1
) -> List[Tuple[AncestralAnchor, float, float]]:
    """
    Compute a weight and an updated sigma per anchor from confidence decay and
    uncertainty propagation.

    Formula:
        sigma_new = sqrt(sigma_canonical^2 + sigma_source_link^2 + drift_penalty^2)
        drift_penalty = drift_rate * generation_age_years
        weight = confidence * exp(-decay_rate * generation_age) / (sigma_new + sigma_floor)
        if is_golden: weight *= golden_multiplier

    Parameters:
        anchors: anchors that passed RANSAC
        decay_rate: confidence decay per year (default 0.2)
        drift_rate: odometer drift per year (metres, default 0.1)
        golden_multiplier: weight multiplier for a golden anchor (default 3.0)
        sigma_floor: lower bound on the weight denominator (default 0.1)

    Returns:
        List of (anchor, weight, sigma_new)
    """
    results = []

    for anchor in anchors:
        drift_penalty = drift_rate * anchor.generation_age
        
        sigma_canonical = anchor.sigma
        sigma_link = max(1.0 - anchor.link_confidence, 0.05)  # link confidence as a sigma

        sigma_new = math.sqrt(
            sigma_canonical ** 2 +
            sigma_link ** 2 +
            drift_penalty ** 2
        )

        weight = (
            anchor.confidence *
            math.exp(-decay_rate * anchor.generation_age) /
            (sigma_new + sigma_floor)
        )

        if anchor.is_golden:
            weight *= golden_multiplier

        results.append((anchor, weight, sigma_new))

    logger.info(
        "Computed weights for %d anchors. Golden count: %d",
        len(results),
        sum(1 for a in anchors if a.is_golden)
    )

    return results


# ===========================================================================
# PHASE 3: BLOCK PARTITIONING
# ===========================================================================

def partition_into_blocks(
    weighted_anchors: List[Tuple[AncestralAnchor, float, float]],
    min_block_size: float = 500.0,
    max_block_size: float = 1000.0
) -> List[Dict[str, Any]]:
    """
    Split the pipeline into blocks delimited by golden anchors.

    Each block is processed independently so an error cannot propagate.  Block
    boundaries land on golden anchors (manually verified GW, TEE, VALVE).

    Parameters:
        weighted_anchors: output of compute_anchor_weights
        min_block_size: minimum block size (metres, default 500)
        max_block_size: maximum block size (metres, default 1000)

    Returns:
        List of dicts: [{start_abs, end_abs, anchors: [(anchor, weight, sigma)]}]
    """
    if not weighted_anchors:
        return []

    # Order by abs_chainage.
    sorted_anchors = sorted(weighted_anchors, key=lambda x: x[0].abs_chainage)

    # Golden anchors are the candidate block boundaries.
    golden_positions = [
        a[0].abs_chainage for a in sorted_anchors if a[0].is_golden
    ]
    
    pipeline_start = sorted_anchors[0][0].abs_chainage
    pipeline_end = sorted_anchors[-1][0].abs_chainage

    # Build the block boundaries.
    boundaries = [pipeline_start]
    
    if golden_positions:
        for pos in sorted(golden_positions):
            last_boundary = boundaries[-1]
            dist_from_last = pos - last_boundary
            
            if dist_from_last >= min_block_size:
                boundaries.append(pos)
            elif dist_from_last > max_block_size:
                # Force a split even though this is not a golden anchor.
                n_splits = int(dist_from_last / max_block_size)
                step = dist_from_last / (n_splits + 1)
                for j in range(1, n_splits + 1):
                    boundaries.append(last_boundary + step * j)
                boundaries.append(pos)
    
    # Make sure pipeline_end is included.
    if boundaries[-1] < pipeline_end:
        boundaries.append(pipeline_end + 0.1)  # small buffer

    # Assign anchors to blocks.
    blocks = []
    for i in range(len(boundaries) - 1):
        start = boundaries[i]
        end = boundaries[i + 1]
        
        block_anchors = [
            (a, w, s) for a, w, s in sorted_anchors
            if a.abs_chainage >= start and a.abs_chainage < end
        ]
        # The last block is inclusive of its end boundary.
        if i == len(boundaries) - 2:
            block_anchors = [
                (a, w, s) for a, w, s in sorted_anchors
                if a.abs_chainage >= start and a.abs_chainage <= end
            ]
        
        if block_anchors:  # skip empty blocks
            blocks.append({
                'start_abs': start,
                'end_abs': end,
                'anchors': block_anchors
            })

    logger.info(
        "Pipeline split into %d blocks (%.1fm - %.1fm)",
        len(blocks), pipeline_start, pipeline_end
    )

    return blocks


# ===========================================================================
# PHASE 4: ANCHOR-CONSTRAINED DTW (banded, in-house implementation)
# ===========================================================================

def resolve_sampling_interval(
    max_distance_m: float,
    base_interval: float = DEFAULT_SAMPLING_INTERVAL_M,
    max_samples: int = MAX_SIGNAL_SAMPLES,
) -> Tuple[float, bool]:
    """Pick the finest sampling step that keeps a signal under ``max_samples``.

    Returns ``(interval_m, was_coarsened)``.  The step is only ever coarsened,
    never refined, and it is rounded up so the resulting sample count is at or
    below the cap.

    Accuracy tradeoff: every warping index resolves to ``interval_m`` metres,
    so a coarsened run localises features to that step instead of 0.1 m.  The
    caller is expected to report the effective interval alongside its results.
    """
    if base_interval <= 0.0:
        raise ValueError("base_interval must be positive")
    if max_samples <= 0:
        raise ValueError("max_samples must be positive")
    if not math.isfinite(max_distance_m) or max_distance_m <= 0.0:
        return base_interval, False
    required = math.ceil(max_distance_m / base_interval)
    if required <= max_samples:
        return base_interval, False
    interval = max_distance_m / max_samples
    # Snap up to a whole multiple of the base step so odometer arithmetic on
    # the coarsened axis stays on the original grid.
    steps = math.ceil(interval / base_interval)
    return base_interval * steps, True


def _compute_cost_matrix(
    signal_source: np.ndarray,
    signal_target: np.ndarray
) -> np.ndarray:
    """Dense euclidean cost matrix between two 1-D signals.

    Legacy helper retained for small inputs and for tests that build a
    reference matrix by hand.  Production code must use
    :func:`dtw_constrained_signals`, which never materialises this matrix.
    """
    s = signal_source.reshape(-1, 1)
    t = signal_target.reshape(-1, 1)
    return cdist(s, t, metric='euclidean')


def _anchor_windows(
    n_source: int,
    n_target: int,
    anchor_constraints: List[Tuple[int, int, float]],
    sampling_interval: float = DEFAULT_SAMPLING_INTERVAL_M,
) -> List[Tuple[int, int, int, int]]:
    """Rectangles ``(i_start, i_end, j_start, j_end)`` allowed by the anchors.

    This is the constraint mask expressed as its generating rectangles instead
    of as an n x m array.  Identical bounds to the historical
    :func:`_build_constraint_mask`, so the two agree cell for cell.
    """
    windows = []
    for src_idx, tgt_idx_est, sigma in anchor_constraints or []:
        window = max(20, int(sigma * 10 / sampling_interval))
        i_start = max(0, src_idx - window)
        i_end = min(n_source, src_idx + window)
        j_start = max(0, int(tgt_idx_est) - window)
        j_end = min(n_target, int(tgt_idx_est) + window)
        if i_start >= i_end or j_start >= j_end:
            continue
        windows.append((int(i_start), int(i_end), int(j_start), int(j_end)))
    return windows


def _build_constraint_mask(
    n_source: int,
    n_target: int,
    anchor_constraints: List[Tuple[int, int, float]],
    sampling_interval: float = DEFAULT_SAMPLING_INTERVAL_M
) -> np.ndarray:
    """Dense INF/0 constraint mask.

    Legacy helper: allocates ``n_source x n_target`` and is therefore only
    usable for small blocks and tests.  The banded solver consumes
    :func:`_anchor_windows` instead.
    """
    mask = np.full((n_source, n_target), np.inf)
    for i_start, i_end, j_start, j_end in _anchor_windows(
        n_source, n_target, anchor_constraints, sampling_interval
    ):
        mask[i_start:i_end, j_start:j_end] = 0.0
    return mask


def _sakoe_chiba_bounds(n: int, m: int, radius: Optional[int]) -> Tuple[np.ndarray, np.ndarray]:
    """Per-row inclusive/exclusive column bounds for a Sakoe-Chiba band.

    Reproduces the historical predicate ``abs(i * m / n - j) > radius`` exactly:
    a column is inside the band when ``abs(centre - j) <= radius``.  Returned
    bounds address DP columns ``1..m`` and are half-open ``[lo, hi)``.
    """
    rows = np.arange(1, n + 1, dtype=np.float64)
    if radius is None:
        lo = np.ones(n, dtype=np.int64)
        hi = np.full(n, m + 1, dtype=np.int64)
        return lo, hi
    centre = rows * (m / n)
    lo = np.maximum(1, np.ceil(centre - radius).astype(np.int64))
    hi = np.minimum(m + 1, np.floor(centre + radius).astype(np.int64) + 1)
    return lo, np.maximum(lo, hi)


def _window_row_bounds(
    n: int,
    m: int,
    windows: List[Tuple[int, int, int, int]],
) -> Tuple[np.ndarray, np.ndarray]:
    """Enclosing ``[lo, hi)`` DP-column bounds per row for a rectangle union.

    Rows covered by no rectangle get an empty band, matching a fully masked
    row.  Where the union is disconnected the enclosing interval is a superset;
    the cells in the gaps still receive the INF mask penalty from
    :func:`_masked_row_cost`, so the result is unchanged.
    """
    lo = np.full(n, m + 1, dtype=np.int64)
    hi = np.ones(n, dtype=np.int64)
    for i_start, i_end, j_start, j_end in windows:
        rows = slice(i_start, i_end)
        # DP column j corresponds to signal column j - 1.
        np.minimum(lo[rows], j_start + 1, out=lo[rows])
        np.maximum(hi[rows], j_end + 1, out=hi[rows])
    empty = lo > hi
    lo[empty] = 1
    hi[empty] = 1
    return lo, hi


def _row_allowed_mask(
    row: int,
    lo: int,
    hi: int,
    windows: List[Tuple[int, int, int, int]],
) -> Optional[np.ndarray]:
    """Boolean vector over DP columns ``[lo, hi)`` marking unmasked cells.

    ``None`` means "every cell in the band is allowed", which is the common
    case and lets the caller skip the penalty add entirely.
    """
    if not windows:
        return None
    allowed = np.zeros(hi - lo, dtype=bool)
    for i_start, i_end, j_start, j_end in windows:
        if not (i_start <= row < i_end):
            continue
        start = max(lo, j_start + 1)
        end = min(hi, j_end + 1)
        if start >= end:
            continue
        allowed[start - lo:end - lo] = True
        if start <= lo and end >= hi:
            return None
    return None if allowed.all() else allowed


def _prefix_min_plus(seed: np.ndarray, cost: np.ndarray) -> np.ndarray:
    """Vectorised (and slightly re-associated) solution of the left recurrence.

    ``d[k] = min(seed[k], d[k-1] + cost[k])`` rewritten as a prefix minimum::

        d[k] = C[k] + min_{t <= k} (seed[t] - C[t]),   C = cumsum(cost)

    The identity only holds while ``cost`` is finite, so the row is split at
    INF cells (masked-out columns).  Those cells are unreachable and also break
    any left chain that would otherwise pass through them, which is exactly the
    behaviour of the sequential recurrence.

    Summing the same terms in a different order can shift a value by an ulp,
    so this is an approximation; :func:`_min_plus_row_scan` verifies and
    repairs it.
    """
    width = seed.shape[0]
    result = np.full(width, np.inf, dtype=np.float64)
    finite = np.isfinite(cost)
    if not finite.any():
        return result
    if finite.all():
        cumulative = np.cumsum(cost)
        result[:] = cumulative + np.minimum.accumulate(seed - cumulative)
        return result

    # Segment boundaries: maximal runs of finite cost.
    padded = np.concatenate(([False], finite, [False]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    for start, end in zip(edges[0::2], edges[1::2]):
        segment_cost = cost[start:end]
        cumulative = np.cumsum(segment_cost)
        result[start:end] = cumulative + np.minimum.accumulate(
            seed[start:end] - cumulative
        )
    return result


def _min_plus_row_scan(seed: np.ndarray, cost: np.ndarray) -> np.ndarray:
    """Exactly resolve ``d[k] = min(seed[k], d[k-1] + cost[k])`` across a row.

    The recurrence is sequential, but a Python loop over every banded cell is
    the single slowest thing this module could do.  So the row is solved with
    the vectorised prefix form, then *verified*: the recurrence has exactly one
    solution for a given ``d[0]``, so a vector that satisfies it at every index
    IS that solution.  Only the tail after the first index that fails the check
    is redone sequentially — which is what makes the result bit-identical to a
    plain left-to-right scan, ties included, rather than merely equal in cost.

    ``min`` keeps its first argument on a tie, so ``seed[k]`` (start a new
    chain here) wins over an equal carried value, exactly like ``min(a, b)``.
    """
    width = seed.shape[0]
    if width == 0:
        return np.empty(0, dtype=np.float64)

    values = _prefix_min_plus(seed, cost)
    # d[k] <= seed[k] is exact in the recurrence; clamping removes the ulp
    # noise everywhere the carried chain did not actually win.
    np.minimum(values, seed, out=values)

    if values[0] != seed[0]:
        start = 0
    else:
        divergent = np.flatnonzero(
            values[1:] != np.minimum(seed[1:], values[:-1] + cost[1:])
        )
        if divergent.size == 0:
            return values
        start = int(divergent[0]) + 1

    tail_seed = seed[start:].tolist()
    tail_cost = cost[start:].tolist()
    repaired = values.tolist()
    previous = repaired[start - 1] if start else np.inf
    for offset in range(width - start):
        candidate = tail_seed[offset]
        carried = previous + tail_cost[offset]
        if carried < candidate:
            candidate = carried
        repaired[start + offset] = candidate
        previous = candidate
    return np.asarray(repaired, dtype=np.float64)


def _banded_dtw(
    n: int,
    m: int,
    lower: np.ndarray,
    upper: np.ndarray,
    row_cost: Callable[[int, int, int], np.ndarray],
) -> Tuple[List[Tuple[int, int]], float, Dict[str, int]]:
    """Banded DTW over ``n x m`` cells without allocating any n*m array.

    ``lower``/``upper`` hold half-open DP-column bounds per source row (index
    ``i - 1`` addresses row ``i``), and ``row_cost(i, lo, hi)`` returns the
    combined cost for DP cells ``(i, lo..hi-1)``.

    Memory is two rolling ``m + 1`` accumulator rows plus one int8 backpointer
    per *banded* cell.  Returns ``(path, total_cost, stats)`` where ``stats``
    reports the band bookkeeping (``banded_cells``, ``full_cells``).
    """
    infinity = float('inf')
    banded_cells = 0

    previous = np.full(m + 1, infinity, dtype=np.float64)
    previous[0] = 0.0
    current = np.empty(m + 1, dtype=np.float64)

    # One entry per row: (lo, int8 move codes over [lo, hi)).
    moves: List[Tuple[int, Optional[np.ndarray]]] = [(1, None)] * (n + 1)

    for i in range(1, n + 1):
        lo = int(lower[i - 1])
        hi = int(upper[i - 1])
        current.fill(infinity)
        if lo >= hi:
            moves[i] = (lo, None)
            previous, current = current, previous
            continue

        cost = row_cost(i, lo, hi)
        diagonal = previous[lo - 1:hi - 1]
        up = previous[lo:hi]
        seed = cost + np.minimum(diagonal, up)
        row = _min_plus_row_scan(seed, cost)
        current[lo:hi] = row

        # Backpointers, resolved exactly like the historical traceback did:
        # min() over (diagonal, up, left) preferring the earlier entry on ties.
        left = np.empty(hi - lo, dtype=np.float64)
        left[0] = infinity
        if hi - lo > 1:
            left[1:] = row[:-1]
        codes = np.where(
            (diagonal <= up) & (diagonal <= left),
            np.int8(_MOVE_DIAGONAL),
            np.where(up <= left, np.int8(_MOVE_UP), np.int8(_MOVE_LEFT)),
        ).astype(np.int8)
        moves[i] = (lo, codes)
        banded_cells += hi - lo

        previous, current = current, previous

    # After the final swap ``previous`` holds row n, so D[n, m] is previous[m].
    total_cost = float(previous[m])
    stats = {"banded_cells": banded_cells, "full_cells": n * m}

    if not math.isfinite(total_cost):
        return [], infinity, stats

    path: List[Tuple[int, int]] = []
    i, j = n, m
    while i > 0 or j > 0:
        path.append((i - 1, j - 1))
        if i == 0:
            j -= 1
        elif j == 0:
            i -= 1
        else:
            lo, codes = moves[i]
            if codes is None or not (lo <= j < lo + codes.shape[0]):
                # Outside the band every predecessor is INF, and min() keeps
                # the first of the equal candidates: the diagonal.
                move = _MOVE_DIAGONAL
            else:
                move = int(codes[j - lo])
            if move == _MOVE_DIAGONAL:
                i -= 1
                j -= 1
            elif move == _MOVE_UP:
                i -= 1
            else:
                j -= 1

    path.reverse()
    # Drop negative indices: the loop appends (i-1, j-1) BEFORE testing
    # i == 0 / j == 0, so a traceback touching row/column 0 can emit -1 pairs.
    # dtw_joint_sequence in engine/math_utils.py applies the same filter.
    path = [(a, b) for (a, b) in path if a >= 0 and b >= 0]
    return path, total_cost, stats


def dtw_constrained(
    cost_matrix: np.ndarray,
    constraint_mask: Optional[np.ndarray] = None,
    sakoe_chiba_band: Optional[int] = None
) -> Tuple[List[Tuple[int, int]], float]:
    """Dynamic time warping over a pre-built cost matrix.

    Compatibility entry point for small inputs and tests: the caller owns the
    dense matrices, and this function adds no n*m allocation of its own — it
    derives per-row column bounds and hands them to the banded solver, which
    produces the same path and cost the historical double loop produced.

    Parameters:
        cost_matrix: cost grid (n_source x n_target)
        constraint_mask: INF/0 mask over the same grid (optional)
        sakoe_chiba_band: band radius in samples (optional, None = full grid)

    Returns:
        (warping_path, total_cost)
    """
    n, m = cost_matrix.shape
    if n == 0 or m == 0:
        return [], float('inf') if (n or m) else 0.0

    lower, upper = _sakoe_chiba_bounds(n, m, sakoe_chiba_band)

    if constraint_mask is not None:
        # Narrow each row to the columns the mask actually permits.  Computed
        # row by row so no extra n*m boolean array is created.
        for i in range(n):
            allowed = np.flatnonzero(np.isfinite(constraint_mask[i]))
            if allowed.size == 0:
                lower[i], upper[i] = 1, 1
                continue
            lower[i] = max(int(lower[i]), int(allowed[0]) + 1)
            upper[i] = min(int(upper[i]), int(allowed[-1]) + 2)
            if lower[i] >= upper[i]:
                lower[i], upper[i] = 1, 1

        def row_cost(i: int, lo: int, hi: int) -> np.ndarray:
            return (
                cost_matrix[i - 1, lo - 1:hi - 1]
                + constraint_mask[i - 1, lo - 1:hi - 1]
            ).astype(np.float64, copy=False)
    else:
        def row_cost(i: int, lo: int, hi: int) -> np.ndarray:
            return cost_matrix[i - 1, lo - 1:hi - 1].astype(np.float64, copy=False)

    path, total_cost, _stats = _banded_dtw(n, m, lower, upper, row_cost)
    return path, total_cost


def dtw_constrained_signals(
    signal_source: np.ndarray,
    signal_target: np.ndarray,
    anchor_constraints: Optional[List[Tuple[int, int, float]]] = None,
    sampling_interval: float = DEFAULT_SAMPLING_INTERVAL_M,
    sakoe_chiba_band: Optional[int] = None,
    band_radius: Optional[int] = None,
) -> Tuple[List[Tuple[int, int]], float, Dict[str, int]]:
    """Banded constrained DTW straight from a pair of 1-D signals.

    The production entry point.  Nothing of size ``n * m`` is allocated: the
    anchor mask is kept as rectangles, the DP keeps two rolling accumulator
    rows, backpointers are one byte per banded cell, and each row's costs are
    the vectorised absolute difference of the source sample against the
    target's band slice (euclidean distance in 1-D, without cdist).

    ``band_radius`` overrides the Sakoe-Chiba radius.  When neither it nor
    ``sakoe_chiba_band`` is given, grids up to ``MAX_UNBANDED_DTW_CELLS`` run
    unbanded — identical to the historical behaviour — and larger ones fall
    back to ``DTW_BAND_RADIUS_SAMPLES``.

    Returns ``(warping_path, total_cost, stats)``.
    """
    source = np.asarray(signal_source, dtype=np.float64).ravel()
    target = np.asarray(signal_target, dtype=np.float64).ravel()
    n, m = source.shape[0], target.shape[0]
    if n == 0 or m == 0:
        return [], float('inf'), {"banded_cells": 0, "full_cells": n * m}

    radius = band_radius if band_radius is not None else sakoe_chiba_band
    if radius is None and n * m > MAX_UNBANDED_DTW_CELLS:
        radius = DTW_BAND_RADIUS_SAMPLES
        logger.info(
            "DTW grid %d x %d exceeds %d cells; applying a Sakoe-Chiba radius "
            "of %d samples (%.1f m at a %.3f m step)",
            n, m, MAX_UNBANDED_DTW_CELLS, radius,
            radius * sampling_interval, sampling_interval,
        )

    lower, upper = _sakoe_chiba_bounds(n, m, radius)
    windows = _anchor_windows(n, m, anchor_constraints or [], sampling_interval)
    if windows:
        window_lower, window_upper = _window_row_bounds(n, m, windows)
        lower = np.maximum(lower, window_lower)
        upper = np.minimum(upper, window_upper)
        empty = lower >= upper
        lower[empty] = 1
        upper[empty] = 1

    def row_cost(i: int, lo: int, hi: int) -> np.ndarray:
        cost = np.abs(target[lo - 1:hi - 1] - source[i - 1])
        allowed = _row_allowed_mask(i - 1, lo, hi, windows)
        if allowed is not None:
            cost = np.where(allowed, cost, np.inf)
        return cost

    return _banded_dtw(n, m, lower, upper, row_cost)


def process_block_dtw(
    signal_source_block: np.ndarray,
    signal_target_block: np.ndarray,
    anchor_constraints: List[Tuple[int, int, float]],
    sampling_interval: float = DEFAULT_SAMPLING_INTERVAL_M,
    sakoe_chiba_band: Optional[int] = None
) -> Tuple[List[Tuple[int, int]], float, bool, bool]:
    """Run DTW for one pipeline block under its anchor constraints.

    Constrained DTW is attempted first; a CORRUPT block falls back to plain
    DTW without the anchor mask.  Both passes are banded, so a 4 km block never
    materialises a cost, mask or accumulator grid.

    Parameters:
        signal_source_block: source MFL signal for this block
        signal_target_block: target MFL signal for this block
        anchor_constraints: [(source_idx, target_idx_est, sigma)]
        sampling_interval: sampling step in metres
        sakoe_chiba_band: Sakoe-Chiba radius in samples

    Returns:
        (warping_path, cost, is_corrupt, need_manual_review)
    """
    if anchor_constraints:
        path, cost, stats = dtw_constrained_signals(
            signal_source_block,
            signal_target_block,
            anchor_constraints,
            sampling_interval,
            sakoe_chiba_band,
        )
        if path:
            logger.info(
                "Constrained DTW succeeded, cost=%.2f (%d of %d cells evaluated)",
                cost, stats["banded_cells"], stats["full_cells"],
            )
            return path, cost, False, False

        logger.warning(
            "Constrained DTW FAILED (corrupt block); falling back to plain DTW"
        )

    path, cost, stats = dtw_constrained_signals(
        signal_source_block,
        signal_target_block,
        None,
        sampling_interval,
        sakoe_chiba_band,
    )

    if path:
        logger.info(
            "Fallback DTW produced a path, cost=%.2f (%d of %d cells evaluated)",
            cost, stats["banded_cells"], stats["full_cells"],
        )
        return path, cost, True, True

    logger.error("DTW failed completely for this block")
    return [], float('inf'), True, True


# ===========================================================================
# PHASE 5: HUNGARIAN MATCHING WITH PRIOR
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
    Hungarian matching with a prior from the DTW warping path and the ancestor
    weights.

    Cost matrix:
        cost = alpha * warped_odometer_distance
             + beta * feature_type_penalty
             + gamma * (1 / weight_of_nearest_ancestor)

    A feature-type mismatch (GW vs METAL_LOSS, say) costs INF.  A match further
    than max_warped_distance from the DTW projection is REJECTED.

    Parameters:
        features_source: features on the source run
        features_target: features on the target run
        warping_path: path from the constrained DTW
        weighted_anchors: anchors with their weights
        source_odom_start: odometer at the start of the source block
        target_odom_start: odometer at the start of the target block
        sampling_interval: signal sampling step
        alpha: weight of the warped distance
        beta: weight of the feature-type penalty (must be large / INF)
        gamma: weight of the inverse ancestor weight
        max_warped_distance: maximum post-warp distance to accept (metres)

    Returns:
        The MatchResults that passed the filters
    """
    if not features_source or not features_target or not warping_path:
        return []

    # Warping lookup: source_idx -> target_idx.
    warp_map = {}
    for s_idx, t_idx in warping_path:
        if s_idx not in warp_map:
            warp_map[s_idx] = t_idx
    
    n_src = len(features_source)
    n_tgt = len(features_target)
    
    # Build the cost matrix.
    cost = np.full((n_src, n_tgt), 1e12)

    for i, fs in enumerate(features_source):
        # Source odometer to signal index.
        src_signal_idx = int((fs.odometer - source_odom_start) / sampling_interval)
        src_signal_idx = max(0, min(src_signal_idx, max(warp_map.keys()) if warp_map else 0))

        # Project onto the target through the warping path.
        projected_tgt_idx = warp_map.get(src_signal_idx, src_signal_idx)
        projected_tgt_odom = target_odom_start + projected_tgt_idx * sampling_interval

        for j, ft in enumerate(features_target):
            # Feature-type penalty.
            if fs.feature_type != ft.feature_type:
                cost[i, j] = 1e12  # INF equivalent
                continue

            # Distance after warping.
            warped_dist = abs(ft.odometer - projected_tgt_odom)

            if warped_dist > max_warped_distance:
                cost[i, j] = 1e12
                continue

            # Weight of the nearest ancestor.
            # fs.odometer is a SOURCE-run odometer, so anchor proximity has to
            # be measured on the odom_source axis — the same axis the
            # abs_chainage interpolation below uses.  Comparing against
            # abs_chainage mixes two coordinate systems and picks the wrong
            # anchor as soon as the RANSAC scale/offset leaves identity.
            closest_weight = 0.1  # default minimum
            if weighted_anchors:
                min_anchor_dist = float('inf')
                for anchor, weight, sigma in weighted_anchors:
                    d = abs(anchor.odom_source - fs.odometer)
                    if d < min_anchor_dist:
                        min_anchor_dist = d
                        closest_weight = max(weight, 0.01)
            
            cost[i, j] = (
                alpha * warped_dist +
                gamma * (1.0 / closest_weight)
            )
    
    # Hungarian assignment.
    try:
        row_indices, col_indices = linear_sum_assignment(cost)
    except ValueError:
        logger.error("Hungarian assignment failed")
        return []

    # Keep only the valid matches.
    matches = []
    for r, c in zip(row_indices, col_indices):
        if cost[r, c] >= 1e11:
            continue  # skip INF cost matches
        
        fs = features_source[r]
        ft = features_target[c]
        
        # abs_chainage for this match, interpolated from the nearest anchor.
        abs_chain = fs.odometer  # fallback
        conf = 0.5

        if weighted_anchors:
            # Nearest anchor drives the interpolation.
            min_d = float('inf')
            for anchor, weight, sigma in weighted_anchors:
                d = abs(anchor.odom_source - fs.odometer)
                if d < min_d:
                    min_d = d
                    abs_chain = anchor.abs_chainage + (fs.odometer - anchor.odom_source)
                    conf = min(0.95, anchor.confidence * 0.9)
        
        # Projected warped distance, which drives the confidence.
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
        "Hungarian matching: %d/%d source features matched",
        len(matches), n_src
    )

    return matches


# ===========================================================================
# PHASE 6: CANONICAL UPDATE (Kalman-like)
# ===========================================================================

def kalman_update_chainage(
    abs_old: float,
    sigma_old: float,
    abs_new: float,
    sigma_new: float
) -> Tuple[float, float]:
    """
    Kalman-like update that fuses the previous and the new estimate.

    Formula:
        abs_updated = (abs_old/sigma_old^2 + abs_new/sigma_new^2) / (1/sigma_old^2 + 1/sigma_new^2)
        sigma_updated = 1 / sqrt(1/sigma_old^2 + 1/sigma_new^2)

    Parameters:
        abs_old: previous abs_chainage estimate
        sigma_old: previous sigma
        abs_new: new abs_chainage estimate
        sigma_new: new sigma

    Returns:
        (abs_updated, sigma_updated)
    """
    # Avoid dividing by zero.
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
    Compute the canonical updates for every accepted match.

    A match whose canonical already exists gets a Kalman update; a new match
    creates a new canonical.

    Parameters:
        matches: the Hungarian matching result
        features_target: target features
        warping_path: DTW warping path
        weighted_anchors: anchors with their weights
        existing_canonicals: {feature_id: (abs_chainage, sigma)} or
            {feature_id: (canonical_id, abs_chainage, sigma)} when the canonical
            identity is already known from an existing-link lookup

    Returns:
        List of dicts describing each canonical update
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
        
        # Sigma for this match.
        sigma_new = max(0.3, 1.0 - match.confidence)

        if match.target_feature_id in existing_canonicals:
            # Kalman update.
            entry = existing_canonicals[match.target_feature_id]
            if len(entry) == 3:
                known_canonical_id, abs_old, sigma_old = entry
            else:
                known_canonical_id = None
                abs_old, sigma_old = entry
            abs_updated, sigma_updated = kalman_update_chainage(
                abs_old, sigma_old, match.abs_chainage, sigma_new
            )
            updates.append({
                'action': 'UPDATE',
                'canonical_id': known_canonical_id,
                'target_feature_id': match.target_feature_id,
                'abs_chainage': abs_updated,
                'sigma': sigma_updated,
                'confidence': match.confidence,
                'anchor_type': target_feat.feature_type,
                'method': match.method
            })
        else:
            # New canonical.
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
# PHASE 7: AUTOMATIC PHYSICAL VALIDATION
# ===========================================================================

def _is_weld_anchor_type(anchor_type: Any) -> bool:
    """Recognise a girth-weld anchor across the spellings ingest produces:
    'GW', 'Weld', 'Girth Weld', 'girth weld', and so on."""
    label = str(anchor_type or '').strip().lower()
    return label == 'gw' or 'weld' in label


def validate_physical_constraints(
    canonical_anchors_sorted: List[Dict[str, Any]],
    block_results: List[BlockResult],
    min_joint_length: float = 3.0,
    max_joint_length: float = 25.0,
    suspect_cost_multiplier: float = 2.5
) -> Tuple[List[Dict[str, Any]], List[int]]:
    """
    Automatic physical validation once every block is done.

    Check 1: the joint length between girth-weld anchors must sit inside the
             sanity band [min_joint_length, max_joint_length].  A breach is
             recorded as a WARNING for review rather than a hard failure —
             non-standard joints (an 18 m double joint, say) do exist in the
             field.
    Check 2: a block whose mean DTW cost exceeds 2.5x the global mean is
             flagged as SUSPECT_SPOOL_REPLACEMENT.

    Parameters:
        canonical_anchors_sorted: canonical anchors ordered by abs_chainage
        block_results: results from every block
        min_joint_length: minimum joint length (metres, default 3.0)
        max_joint_length: maximum joint length (metres, default 25.0)
        suspect_cost_multiplier: spool-replacement detection multiplier (default 2.5)

    Returns:
        (violations, suspect_block_indices)
        violations: dicts of {index, chainage_i, chainage_j, joint_length, type}
        suspect_block_indices: indices of blocks suspected of spool replacement
    """
    violations = []

    # Check 1: joint-length warnings between girth welds.
    gw_anchors = [
        a for a in canonical_anchors_sorted
        if _is_weld_anchor_type(a.get('anchor_type'))
    ]
    gw_anchors.sort(key=lambda x: x['abs_chainage'])

    for i in range(len(gw_anchors) - 1):
        joint_length = gw_anchors[i + 1]['abs_chainage'] - gw_anchors[i]['abs_chainage']

        if joint_length < min_joint_length or joint_length > max_joint_length:
            logger.warning(
                "Joint length %.2fm is outside the sanity band [%.1f, %.1f]m "
                "(chainage %.2f -> %.2f) — flagged for review",
                joint_length, min_joint_length, max_joint_length,
                gw_anchors[i]['abs_chainage'], gw_anchors[i + 1]['abs_chainage']
            )
            violations.append({
                'index': i,
                'chainage_i': gw_anchors[i]['abs_chainage'],
                'chainage_j': gw_anchors[i + 1]['abs_chainage'],
                'joint_length': joint_length,
                'type': 'PHYSICALLY_IMPOSSIBLE'
            })
    
    # Check 2: suspected spool replacement.
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
        "Physical validation: %d joint violations, %d suspect blocks",
        len(violations), len(suspect_blocks)
    )
    
    return violations, suspect_blocks

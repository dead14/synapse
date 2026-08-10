"""Structural anchors and their fingerprints (sections 6, 7 and 25.5).

Girth welds are usually the densest anchor but never the only concept: every
persistent structure is an anchor with a type, a position, a descriptor and a
reliability, and the descriptor is built from whatever is available.  A dataset
with no wall-thickness column must still be alignable on the rest, which is
what the availability mask in :func:`anchor_distance` is for.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field

from .canonical import CanonicalFeature
from .config import AnchorConfig
from .profile import anchor_reliability


@dataclass
class Anchor:
    """One structural anchor with its multi-scale descriptor."""

    index: int
    feature: CanonicalFeature
    anchor_type: str
    x_m: float
    reliability: float
    # Neighbouring edge lengths, longest window first.  ``None`` entries are
    # unavailable evidence at the ends of the run, not zero-length joints.
    edges: list[float | None] = field(default_factory=list)
    # Normalised edge lengths, keyed by the window they were normalised over.
    # The scale has to be the window's own median, not the widest window's: an
    # anchor next to a merged joint would otherwise carry that merged length in
    # every scale it is compared at, and the short windows — the ones that are
    # supposed to survive a local structural change — would be poisoned by it.
    ratios_by_window: dict[int, list[float | None]] = field(default_factory=dict)
    wall_thickness_mm: float | None = None
    # Best-versus-second-best separation, filled in by the candidate builder.
    uniqueness: float = 0.0

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "type": self.anchor_type,
            "xM": round(self.x_m, 4),
            "reliability": round(self.reliability, 3),
            "uniqueness": round(self.uniqueness, 4),
            "sourceId": self.feature.source_id,
            "key": self.feature.key,
        }


def extract_anchors(
    features: list[CanonicalFeature],
    config: AnchorConfig,
) -> list[Anchor]:
    """Every persistent structure in the run, in odometer order.

    Features must already be sorted by position; the caller does that once in
    :func:`canonical.partition_positioned` so the ordering is the same list the
    conservation audit sees.
    """
    candidates = [f for f in features if f.is_anchor and math.isfinite(f.x_raw_m)]
    anchors = [
        Anchor(
            index=index,
            feature=feature,
            anchor_type=feature.feature_class,
            x_m=feature.x_raw_m,
            reliability=anchor_reliability(feature.feature_class),
            wall_thickness_mm=feature.wall_thickness_mm,
        )
        for index, feature in enumerate(candidates)
    ]
    _attach_descriptors(anchors, config)
    return anchors


def _attach_descriptors(anchors: list[Anchor], config: AnchorConfig) -> None:
    """Multi-scale edge-length descriptors, absolute and normalised.

    The normalised form ``r_k = L_k / median(local window)`` is what survives a
    drifting odometer: a run reported 0.4% long has every joint 0.4% long, so
    the ratios are unchanged while the absolute lengths are not.
    """
    positions = [a.x_m for a in anchors]
    edge_lengths = [
        right - left for left, right in zip(positions, positions[1:])
    ]
    widest = max(config.windows)

    for anchor in anchors:
        index = anchor.index
        edges: list[float | None] = []
        for offset in range(-widest, widest):
            edge_index = index + offset
            edges.append(
                edge_lengths[edge_index]
                if 0 <= edge_index < len(edge_lengths)
                else None
            )
        anchor.edges = edges

        for window in config.windows:
            low = widest - window
            high = widest + window
            present = [
                value for value in edges[low:high]
                if value is not None and value > 0
            ]
            scale = statistics.median(present) if present else None
            anchor.ratios_by_window[window] = [
                (value / scale) if (value is not None and scale) else None
                for value in edges
            ]


def _huber(residual: float, kappa: float, ceiling: float) -> float:
    absolute = abs(residual)
    if absolute <= kappa:
        return min(0.5 * residual * residual, ceiling)
    return min(kappa * (absolute - 0.5 * kappa), ceiling)


def anchor_distance(
    left: Anchor,
    right: Anchor,
    config: AnchorConfig,
    window: int | None = None,
) -> float:
    """Masked, robust descriptor distance ``D_anchor`` (section 7).

    Every term carries an availability mask, and the sum is normalised over the
    terms that were actually available.  Missing information removes evidence;
    it must never manufacture a penalty.
    """
    span = window if window is not None else max(config.windows)
    widest = max(config.windows)
    centre = widest  # index of the edge immediately downstream of the anchor
    left_ratios = left.ratios_by_window.get(span, [])
    right_ratios = right.ratios_by_window.get(span, [])

    total = 0.0
    weight_total = 0.0

    for offset in range(-span, span):
        position = centre + offset
        if not (0 <= position < len(left_ratios) and 0 <= position < len(right_ratios)):
            continue
        left_ratio = left_ratios[position]
        right_ratio = right_ratios[position]
        if left_ratio is not None and right_ratio is not None:
            residual = (left_ratio - right_ratio) / config.ratio_sigma
            total += config.weight_ratio * _huber(residual, config.huber_kappa, config.max_term_loss)
            weight_total += config.weight_ratio
        left_edge = left.edges[position]
        right_edge = right.edges[position]
        if left_edge is not None and right_edge is not None:
            residual = (left_edge - right_edge) / config.length_sigma_m
            total += config.weight_length * _huber(residual, config.huber_kappa, config.max_term_loss)
            weight_total += config.weight_length

    # Type agreement is strong evidence when both sides know the type: a valve
    # is not a bend, however similar the joint lengths around them look.
    if left.anchor_type and right.anchor_type:
        penalty = 0.0 if left.anchor_type == right.anchor_type else 1.6
        total += config.weight_type * penalty
        weight_total += config.weight_type

    if left.wall_thickness_mm is not None and right.wall_thickness_mm is not None:
        residual = (left.wall_thickness_mm - right.wall_thickness_mm) / 0.6
        total += config.weight_wall_thickness * _huber(residual, config.huber_kappa, config.max_term_loss)
        weight_total += config.weight_wall_thickness

    if weight_total <= 0:
        # No shared evidence at all.  That is not a good match and not a bad
        # one; it is no evidence, and the caller's uniqueness test is what
        # keeps it from becoming a hard correspondence.
        return 4.0
    return total / weight_total


def adaptive_similarity(
    left: Anchor,
    right: Anchor,
    config: AnchorConfig,
) -> tuple[float, int]:
    """``S_anchor = exp(-D_anchor)`` at its best window, plus that window.

    Every configured window is evaluated and the most decisive one wins, so a
    distinctive short pup is recognised at K=2 while a repetitive pipe string
    falls through to the widest window (section 7.1).  The window travels with
    the score because it is part of the audit trail: it says how much context
    the correspondence needed.
    """
    best_score = 0.0
    best_window = config.windows[0]
    for window in config.windows:
        score = math.exp(-anchor_distance(left, right, config, window))
        if score > best_score:
            best_score, best_window = score, window
    return best_score, best_window


def coarse_offset_vote(
    old_anchors: list[Anchor],
    new_anchors: list[Anchor],
    config: AnchorConfig,
    bin_width_m: float = 1.0,
    max_pairs: int = 200_000,
) -> float:
    """Global axial offset by Hough-style voting over descriptor-similar pairs.

    This exists to *band* the sequence solver (section 8), not to decide
    identity.  It has to survive a run whose absolute odometer is metres out,
    so the vote is over differences rather than over positions.
    """
    if not old_anchors or not new_anchors:
        return 0.0

    # Voting over every pair is O(n*m); on a long line that is millions of
    # combinations for a number that only has to be roughly right.  Sampling
    # evenly along the run keeps it bounded without biasing the estimate to one
    # end of the pipeline.
    step_old = max(1, len(old_anchors) * len(new_anchors) // max_pairs)
    votes: dict[int, float] = {}
    for old_anchor in old_anchors[::step_old]:
        for new_anchor in new_anchors:
            delta = new_anchor.x_m - old_anchor.x_m
            similarity, _window = adaptive_similarity(old_anchor, new_anchor, config)
            if similarity <= 0.05:
                continue
            key = int(round(delta / bin_width_m))
            votes[key] = votes.get(key, 0.0) + similarity

    if not votes:
        return 0.0
    best_bin = max(votes, key=votes.__getitem__)
    # Refine within the winning bin and its neighbours so the estimate is not
    # quantised to the bin width.
    weighted_sum = 0.0
    weight = 0.0
    for offset in (-1, 0, 1):
        value = votes.get(best_bin + offset)
        if value:
            weighted_sum += value * (best_bin + offset) * bin_width_m
            weight += value
    return weighted_sum / weight if weight else best_bin * bin_width_m

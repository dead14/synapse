"""Monotonic structural registration — the anti-jump core (sections 8, 25.6).

Structural correspondence is an order-preserving sequence problem, not a global
assignment.  A missing weld is a gap, an extra weld is an insertion, and a
numerically attractive candidate on the far side of the pipeline is never
selected by jumping over already registered physical order.

The no-crossing invariant is a hard invariant, not a preference.  A crossing
output is treated as a defect in this module, which is why
:func:`assert_non_crossing` raises rather than lowering a confidence.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .anchors import Anchor, adaptive_similarity
from .config import AnchorConfig, StructureConfig

MATCH = "MATCH"
INSERTION = "INSERTION"        # an anchor the new run reports and the old does not
DELETION = "DELETION"          # an anchor the old run reports and the new does not
STRUCTURAL_CHANGE = "STRUCTURAL_CHANGE"

_NEG_INF = -1.0e18

# Reference similarity for the log-evidence term.  ``log(S / S_ref)`` is the
# specification's log form written against an explicit operating point, so a
# candidate better than the reference scores positive and a worse one scores
# negative.  Without it every match term would be non-positive and a gap would
# always look cheaper than a correspondence.
_SIMILARITY_REFERENCE = 0.22


@dataclass
class StructuralEvent:
    kind: str
    old_index: int | None
    new_index: int | None
    old_x_m: float | None
    new_x_m: float | None
    similarity: float = 0.0
    window: int = 0
    uniqueness: float = 0.0

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "oldIndex": self.old_index,
            "newIndex": self.new_index,
            "oldXM": round(self.old_x_m, 4) if self.old_x_m is not None else None,
            "newXM": round(self.new_x_m, 4) if self.new_x_m is not None else None,
            "similarity": round(self.similarity, 4),
            "window": self.window,
            "uniqueness": round(self.uniqueness, 4),
        }


@dataclass
class ChangeZone:
    """A stretch where the physical structure itself changed (section 8.1)."""

    start_old_index: int | None
    end_old_index: int | None
    start_new_index: int | None
    end_new_index: int | None
    old_x_from: float | None
    old_x_to: float | None
    new_x_from: float | None
    new_x_to: float | None
    reason: str
    inserted: int
    deleted: int

    def to_dict(self) -> dict:
        return {
            "oldXFrom": self.old_x_from,
            "oldXTo": self.old_x_to,
            "newXFrom": self.new_x_from,
            "newXTo": self.new_x_to,
            "reason": self.reason,
            "inserted": self.inserted,
            "deleted": self.deleted,
        }


@dataclass
class AnchorMap:
    events: list[StructuralEvent] = field(default_factory=list)
    change_zones: list[ChangeZone] = field(default_factory=list)
    coarse_offset_m: float = 0.0
    score: float = 0.0

    @property
    def matches(self) -> list[StructuralEvent]:
        return [event for event in self.events if event.kind == MATCH]

    def confidence(self) -> float:
        """How much of the structure was actually explained by correspondence.

        Reported as matched anchors over the smaller anchor population, so a
        run that reports twice as many anchors as the other cannot inflate it.
        """
        matched = len(self.matches)
        old_total = sum(1 for e in self.events if e.old_index is not None)
        new_total = sum(1 for e in self.events if e.new_index is not None)
        denominator = max(1, min(old_total, new_total))
        return min(1.0, matched / denominator)

    def to_dict(self, max_events: int = 4000) -> dict:
        events = [event.to_dict() for event in self.events[:max_events]]
        return {
            "coarseOffsetM": round(self.coarse_offset_m, 3),
            "score": round(self.score, 3),
            "confidence": round(self.confidence(), 4),
            "matched": len(self.matches),
            "inserted": sum(1 for e in self.events if e.kind == INSERTION),
            "deleted": sum(1 for e in self.events if e.kind == DELETION),
            "eventCount": len(self.events),
            "eventsTruncated": max(0, len(self.events) - max_events),
            "events": events,
            "changeZones": [zone.to_dict() for zone in self.change_zones],
        }


def _band_for_row(
    predicted: float,
    new_positions: np.ndarray,
    config: StructureConfig,
    row_index: int,
    index_scale: float,
) -> tuple[int, int]:
    """Candidate columns for one old anchor.

    Banding is computational only.  It is wide enough that a badly distorted
    odometer still has its true partner inside the band, and it is bounded in
    index space as well so a dense cluster of anchors cannot let one row cover
    the whole run.
    """
    low = int(np.searchsorted(new_positions, predicted - config.band_m, side="left"))
    high = int(np.searchsorted(new_positions, predicted + config.band_m, side="right"))
    centre = int(round(row_index * index_scale))
    low = max(low, centre - config.band_indices)
    high = min(high, centre + config.band_indices + 1)
    if high <= low:
        # Never return an empty band: a row with no candidates can only be
        # deleted, and that is a decision for the solver, not for the bander.
        centre = min(max(centre, 0), len(new_positions))
        low = max(0, centre - 1)
        high = min(len(new_positions), low + 2)
    return low, high


def _match_score(
    old_anchor: Anchor,
    new_anchor: Anchor,
    similarity: float,
    predicted_x: float,
    position_sigma_m: float,
    position_weight: float,
    config: StructureConfig,
) -> float:
    evidence = config.weight_fingerprint * math.log(
        (similarity + 1e-9) / _SIMILARITY_REFERENCE
    )
    type_term = config.weight_type * (
        1.0 if old_anchor.anchor_type == new_anchor.anchor_type else -1.0
    )
    # On the first pass this is deliberately weak and broad: if the absolute
    # odometer is badly distorted the fingerprint and the sequence must
    # dominate.  On the refinement pass the prediction comes from a fitted
    # monotonic map, so the same term is allowed to be sharp.
    residual = (new_anchor.x_m - predicted_x) / max(position_sigma_m, 1e-6)
    coarse_term = position_weight * (math.exp(-residual * residual) - 0.5)
    return evidence + type_term + coarse_term


def register_structure(
    old_anchors: list[Anchor],
    new_anchors: list[Anchor],
    anchor_config: AnchorConfig,
    config: StructureConfig,
    coarse_offset_m: float = 0.0,
    coarse_map: np.ndarray | None = None,
    position_sigma_m: float | None = None,
    position_weight: float | None = None,
) -> AnchorMap:
    """Banded affine-gap sequence alignment over the two anchor lists.

    Permitted events are MATCH, INSERTION and DELETION.  Crossing mappings are
    not representable by the recurrence, which is the point: the invariant is
    structural, not a post-hoc filter.

    ``coarse_map`` is an optional per-old-anchor predicted position from an
    earlier pass; with it the position term may be sharp, without it the whole
    burden falls on the fingerprints and the sequence.
    """
    anchor_map = AnchorMap(coarse_offset_m=coarse_offset_m)
    if not old_anchors or not new_anchors:
        anchor_map.events = _all_unmatched(old_anchors, new_anchors)
        return anchor_map

    rows = len(old_anchors)
    columns = len(new_anchors)
    new_positions = np.array([anchor.x_m for anchor in new_anchors], dtype=float)
    index_scale = columns / rows if rows else 1.0
    if coarse_map is None:
        predictions = np.array(
            [anchor.x_m + coarse_offset_m for anchor in old_anchors], dtype=float
        )
    else:
        predictions = np.asarray(coarse_map, dtype=float)
    sigma = position_sigma_m if position_sigma_m is not None else config.band_m
    weight = (
        position_weight if position_weight is not None
        else config.weight_coarse_position
    )

    bands: list[tuple[int, int]] = [
        _band_for_row(float(predictions[i]), new_positions, config, i, index_scale)
        for i in range(rows)
    ]

    # Row 0 of the DP is the empty old prefix.  Leading insertions are free:
    # two runs of the same line may simply start at different chainages, and
    # charging for that would push the solver into inventing correspondences.
    previous_low, previous_high = 0, columns + 1
    previous_m = np.full(columns + 1, _NEG_INF)
    previous_ix = np.zeros(columns + 1)
    previous_iy = np.full(columns + 1, _NEG_INF)
    previous_m[0] = 0.0
    previous_iy[0] = 0.0

    trace_m: list[np.ndarray] = []
    trace_ix: list[np.ndarray] = []
    trace_iy: list[np.ndarray] = []
    row_bands: list[tuple[int, int]] = []
    similarity_rows: list[np.ndarray] = []
    window_rows: list[np.ndarray] = []

    def read(array: np.ndarray, low: int, index: int) -> float:
        position = index - low
        if position < 0 or position >= array.shape[0]:
            return _NEG_INF
        return float(array[position])

    for i in range(1, rows + 1):
        low, high = bands[i - 1]
        # Consecutive bands must stay connected or a row would have no
        # reachable predecessor at all and the whole path below it would be
        # lost.  Bands are monotone in i, so this only ever bites where the
        # predicted position jumps further than one band width.
        low = max(0, min(low, previous_high))
        high = max(high, low + 1)
        width = high - low + 1
        current_m = np.full(width, _NEG_INF)
        current_ix = np.full(width, _NEG_INF)
        current_iy = np.full(width, _NEG_INF)
        pointer_m = np.zeros(width, dtype=np.int8)
        pointer_ix = np.zeros(width, dtype=np.int8)
        pointer_iy = np.zeros(width, dtype=np.int8)
        similarities = np.zeros(width)
        windows = np.zeros(width, dtype=np.int16)

        old_anchor = old_anchors[i - 1]
        for j in range(low, high + 1):
            slot = j - low
            if j == 0:
                # Leading deletions are free for the same reason leading
                # insertions are.
                current_iy[slot] = 0.0
                pointer_iy[slot] = 2
                continue

            new_anchor = new_anchors[j - 1]
            similarity, window = adaptive_similarity(
                old_anchor, new_anchor, anchor_config
            )
            similarities[slot] = similarity
            windows[slot] = window
            score = _match_score(
                old_anchor, new_anchor, similarity,
                float(predictions[i - 1]), sigma, weight, config,
            )

            diagonal = (
                read(previous_m, previous_low, j - 1),
                read(previous_ix, previous_low, j - 1),
                read(previous_iy, previous_low, j - 1),
            )
            best_state = int(np.argmax(diagonal))
            best_value = diagonal[best_state]
            if best_value > _NEG_INF / 2:
                current_m[slot] = best_value + score
                pointer_m[slot] = best_state

            # Insertion: consume the new anchor only, staying on this old row.
            left_m = current_m[slot - 1] if slot > 0 else _NEG_INF
            left_ix = current_ix[slot - 1] if slot > 0 else _NEG_INF
            left_iy = current_iy[slot - 1] if slot > 0 else _NEG_INF
            options = (
                left_m - config.gap_open,
                left_ix - config.gap_extend,
                left_iy - config.gap_open,
            )
            best_state = int(np.argmax(options))
            if options[best_state] > _NEG_INF / 2:
                current_ix[slot] = options[best_state]
                pointer_ix[slot] = best_state

            # Deletion: consume the old anchor only.
            up_m = read(previous_m, previous_low, j)
            up_ix = read(previous_ix, previous_low, j)
            up_iy = read(previous_iy, previous_low, j)
            options = (
                up_m - config.gap_open,
                up_ix - config.gap_open,
                up_iy - config.gap_extend,
            )
            best_state = int(np.argmax(options))
            if options[best_state] > _NEG_INF / 2:
                current_iy[slot] = options[best_state]
                pointer_iy[slot] = best_state

        trace_m.append(pointer_m)
        trace_ix.append(pointer_ix)
        trace_iy.append(pointer_iy)
        row_bands.append((low, high))
        similarity_rows.append(similarities)
        window_rows.append(windows)

        previous_m, previous_ix, previous_iy = current_m, current_ix, current_iy
        previous_low, previous_high = low, high

    events, score = _traceback(
        rows,
        columns,
        row_bands,
        trace_m,
        trace_ix,
        trace_iy,
        similarity_rows,
        window_rows,
        previous_m,
        previous_ix,
        previous_iy,
        previous_low,
        old_anchors,
        new_anchors,
    )
    anchor_map.events = events
    anchor_map.score = score
    assert_non_crossing(anchor_map)
    anchor_map.change_zones = detect_change_zones(anchor_map, config)
    return anchor_map


def _traceback(
    rows: int,
    columns: int,
    row_bands: list[tuple[int, int]],
    trace_m: list[np.ndarray],
    trace_ix: list[np.ndarray],
    trace_iy: list[np.ndarray],
    similarity_rows: list[np.ndarray],
    window_rows: list[np.ndarray],
    final_m: np.ndarray,
    final_ix: np.ndarray,
    final_iy: np.ndarray,
    final_low: int,
    old_anchors: list[Anchor],
    new_anchors: list[Anchor],
) -> tuple[list[StructuralEvent], float]:
    low, high = row_bands[-1]
    best_value = _NEG_INF
    best_state = 0
    best_column = columns

    # Trailing gaps are free, so the alignment may finish anywhere on the last
    # row; the best cell on that row is the end of the path.
    for j in range(low, min(high, columns) + 1):
        slot = j - low
        for state, array in enumerate((final_m, final_ix, final_iy)):
            if slot >= array.shape[0]:
                continue
            value = float(array[slot])
            if value > best_value:
                best_value, best_state, best_column = value, state, j

    events: list[StructuralEvent] = []
    i, j, state = rows, best_column, best_state

    # Anything past the end of the path on either side is unmatched, not
    # matched to whatever happened to be nearest.
    for trailing in range(columns, j, -1):
        events.append(_insertion_event(new_anchors[trailing - 1]))

    while i > 0 or j > 0:
        if i == 0:
            events.append(_insertion_event(new_anchors[j - 1]))
            j -= 1
            continue
        if j == 0:
            events.append(_deletion_event(old_anchors[i - 1]))
            i -= 1
            continue

        low, _high = row_bands[i - 1]
        slot = j - low
        if state == 0:
            similarity = float(similarity_rows[i - 1][slot]) if 0 <= slot < similarity_rows[i - 1].shape[0] else 0.0
            window = int(window_rows[i - 1][slot]) if 0 <= slot < window_rows[i - 1].shape[0] else 0
            events.append(StructuralEvent(
                kind=MATCH,
                old_index=old_anchors[i - 1].index,
                new_index=new_anchors[j - 1].index,
                old_x_m=old_anchors[i - 1].x_m,
                new_x_m=new_anchors[j - 1].x_m,
                similarity=similarity,
                window=window,
            ))
            state = int(trace_m[i - 1][slot]) if 0 <= slot < trace_m[i - 1].shape[0] else 0
            i -= 1
            j -= 1
        elif state == 1:
            events.append(_insertion_event(new_anchors[j - 1]))
            state = int(trace_ix[i - 1][slot]) if 0 <= slot < trace_ix[i - 1].shape[0] else 0
            j -= 1
        else:
            events.append(_deletion_event(old_anchors[i - 1]))
            state = int(trace_iy[i - 1][slot]) if 0 <= slot < trace_iy[i - 1].shape[0] else 0
            i -= 1

    events.reverse()
    return events, best_value


def _insertion_event(anchor: Anchor) -> StructuralEvent:
    return StructuralEvent(
        kind=INSERTION,
        old_index=None,
        new_index=anchor.index,
        old_x_m=None,
        new_x_m=anchor.x_m,
    )


def _deletion_event(anchor: Anchor) -> StructuralEvent:
    return StructuralEvent(
        kind=DELETION,
        old_index=anchor.index,
        new_index=None,
        old_x_m=anchor.x_m,
        new_x_m=None,
    )


def _all_unmatched(
    old_anchors: list[Anchor], new_anchors: list[Anchor]
) -> list[StructuralEvent]:
    return (
        [_deletion_event(anchor) for anchor in old_anchors]
        + [_insertion_event(anchor) for anchor in new_anchors]
    )


def _reject_residual_outliers(
    matches: list[StructuralEvent], config: StructureConfig
) -> list[StructuralEvent]:
    """Drop pairs whose residual disagrees with their own neighbourhood.

    Odometer drift is smooth: neighbouring anchors share a residual, and a pair
    that steps away from its neighbours by metres has been matched one joint
    sideways.  Rejecting those before fitting the coarse map is what stops the
    refinement pass from inheriting and then confirming the first pass's
    mistakes.
    """
    if len(matches) < 3:
        return matches
    residuals = [event.new_x_m - event.old_x_m for event in matches]
    window = max(1, config.refine_outlier_window)
    kept: list[StructuralEvent] = []
    for index, event in enumerate(matches):
        low = max(0, index - window)
        high = min(len(residuals), index + window + 1)
        neighbourhood = residuals[low:index] + residuals[index + 1:high]
        if not neighbourhood:
            kept.append(event)
            continue
        local = float(np.median(neighbourhood))
        spread = float(np.median([abs(value - local) for value in neighbourhood]))
        gate = max(config.refine_outlier_m, 3.0 * 1.4826 * spread)
        if abs(residuals[index] - local) <= gate:
            kept.append(event)
    return kept


def build_coarse_map(
    anchor_map: AnchorMap,
    old_anchors: list[Anchor],
    config: StructureConfig,
) -> np.ndarray | None:
    """A monotonic coarse map ``x_B = f(x_A)`` from the trusted pairs (10.2).

    Fitted only on matches whose fingerprint evidence was strong, then
    interpolated piecewise-linearly across the rest.  It is never extrapolated
    beyond the trusted anchors by more than the constant end offset, because an
    unbounded extrapolation is how a coordinate system gets stretched through a
    region nothing supports.
    """
    trusted = [
        event for event in anchor_map.matches
        if event.similarity >= config.refine_min_similarity
    ]
    if len(trusted) < config.refine_min_pairs:
        return None

    trusted = _reject_residual_outliers(trusted, config)
    if len(trusted) < config.refine_min_pairs:
        return None

    old_positions = [event.old_x_m for event in trusted]
    new_positions = [event.new_x_m for event in trusted]
    # The DP already guarantees monotonicity, but a duplicated position would
    # make np.interp ill-defined, so equal keys are dropped rather than
    # averaged.
    keys: list[float] = []
    values: list[float] = []
    for old_x, new_x in zip(old_positions, new_positions):
        if keys and old_x <= keys[-1]:
            continue
        keys.append(old_x)
        values.append(new_x)
    if len(keys) < config.refine_min_pairs:
        return None

    return np.interp(
        np.array([anchor.x_m for anchor in old_anchors], dtype=float),
        np.array(keys, dtype=float),
        np.array(values, dtype=float),
    )


def register_structure_two_pass(
    old_anchors: list[Anchor],
    new_anchors: list[Anchor],
    anchor_config: AnchorConfig,
    config: StructureConfig,
    coarse_offset_m: float = 0.0,
) -> AnchorMap:
    """Register once to learn the coarse map, then again against it.

    The first pass cannot lean on absolute position — a drifted odometer would
    poison it — so it runs on fingerprints and sequence alone with a broad
    positional term.  That is enough to recover the map, and the second pass
    then has a reliable prediction to score against, which is what stops a
    fingerprint degraded by a neighbouring change zone from dragging a match
    one joint sideways.
    """
    first = register_structure(
        old_anchors, new_anchors, anchor_config, config, coarse_offset_m
    )
    coarse_map = build_coarse_map(first, old_anchors, config)
    if coarse_map is None:
        return first

    second = register_structure(
        old_anchors, new_anchors, anchor_config, config, coarse_offset_m,
        coarse_map=coarse_map,
        position_sigma_m=config.refine_position_sigma_m,
        position_weight=config.refine_weight_position,
    )
    # More explained structure wins.  A refinement that registers *less* than
    # the pass it came from has been misled by its own prediction, and keeping
    # it would be worse than not refining at all.
    return second if len(second.matches) >= len(first.matches) else first


def assert_non_crossing(anchor_map: AnchorMap) -> None:
    """``i1 < i2`` must imply ``j1 < j2`` (section 8.2).

    A violation is an algorithm defect or a corrupted structural map, not a
    low-confidence match, so it raises instead of being scored down.
    """
    previous_old: int | None = None
    previous_new: int | None = None
    for event in anchor_map.matches:
        if previous_old is not None and event.old_index <= previous_old:
            raise ValueError(
                "Structural map is not monotonic on the OLD axis: anchor "
                f"{event.old_index} follows {previous_old}."
            )
        if previous_new is not None and event.new_index <= previous_new:
            raise ValueError(
                "Crossing structural correspondence: OLD anchor "
                f"{event.old_index} maps to NEW {event.new_index}, which is "
                f"upstream of the previously matched NEW anchor {previous_new}."
            )
        previous_old, previous_new = event.old_index, event.new_index


def detect_change_zones(
    anchor_map: AnchorMap, config: StructureConfig
) -> list[ChangeZone]:
    """Long unmatched runs and residual jumps read as physical modification.

    The old coordinate system is not stretched through a modified region; the
    alignment is split there and the zone is reported so a reviewer confirms it
    (section 8.1).
    """
    zones: list[ChangeZone] = []
    run_start: int | None = None
    inserted = 0
    deleted = 0

    def close(end_position: int) -> None:
        nonlocal run_start, inserted, deleted
        if run_start is None:
            return
        if inserted + deleted >= config.change_zone_gap_run:
            # The block is widened to the matched anchors on either side.  A
            # zone made only of insertions has no old coordinate of its own, so
            # without the enclosing matches nothing downstream could tell which
            # stretch of the *old* run the modification affects — and the
            # anomalies there would be aligned straight through it.
            block = anchor_map.events[
                max(0, run_start - 1):min(len(anchor_map.events), end_position + 1)
            ]
            old_positions = [e.old_x_m for e in block if e.old_x_m is not None]
            new_positions = [e.new_x_m for e in block if e.new_x_m is not None]
            zones.append(ChangeZone(
                start_old_index=next((e.old_index for e in block if e.old_index is not None), None),
                end_old_index=next((e.old_index for e in reversed(block) if e.old_index is not None), None),
                start_new_index=next((e.new_index for e in block if e.new_index is not None), None),
                end_new_index=next((e.new_index for e in reversed(block) if e.new_index is not None), None),
                old_x_from=min(old_positions) if old_positions else None,
                old_x_to=max(old_positions) if old_positions else None,
                new_x_from=min(new_positions) if new_positions else None,
                new_x_to=max(new_positions) if new_positions else None,
                reason=(
                    f"{inserted} inserted and {deleted} missing anchors in one "
                    "stretch — repair, cut-out, reroute or spool replacement"
                ),
                inserted=inserted,
                deleted=deleted,
            ))
        run_start, inserted, deleted = None, 0, 0

    for position, event in enumerate(anchor_map.events):
        if event.kind in (INSERTION, DELETION):
            if run_start is None:
                run_start = position
            inserted += event.kind == INSERTION
            deleted += event.kind == DELETION
        else:
            close(position)
    close(len(anchor_map.events))

    # A stretch that stays matched but whose axial residual steps by more than
    # the configured break is also a change zone: the sequence did not lose an
    # anchor, the pipe moved.
    matches = anchor_map.matches
    for left, right in zip(matches, matches[1:]):
        left_residual = left.new_x_m - left.old_x_m
        right_residual = right.new_x_m - right.old_x_m
        if abs(right_residual - left_residual) > config.change_zone_residual_m:
            zones.append(ChangeZone(
                start_old_index=left.old_index,
                end_old_index=right.old_index,
                start_new_index=left.new_index,
                end_new_index=right.new_index,
                old_x_from=left.old_x_m,
                old_x_to=right.old_x_m,
                new_x_from=left.new_x_m,
                new_x_to=right.new_x_m,
                reason=(
                    "axial residual steps by "
                    f"{abs(right_residual - left_residual):.2f} m across one joint"
                ),
                inserted=0,
                deleted=0,
            ))
    return zones

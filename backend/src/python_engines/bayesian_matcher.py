"""Probabilistic anomaly matching for two runs whose odometers disagree.

Why this exists
---------------
The tolerance-gated matcher in ``hungarian_engine`` answers one question: *is
this pair inside the window the engineer allowed?*  It is the right question
whenever the two runs agree on chainage to within a metre, and it is the wrong
question when they do not.  A section whose girth welds locked cleanly can
still have every metal-loss pair displaced by several metres — a slipped
odometer wheel, a vendor reporting from a different reference point, a
re-chainage between surveys.  A fixed window centred on zero then rejects
*every* pair, and the section comes back with matched welds and nothing else.

This module asks a different question, and never uses a tolerance to answer it:

    Given everything the two runs report about these two defects, how much more
    likely is the evidence if they are the same defect than if they are two
    unrelated defects that happen to lie near each other?

That ratio is a Bayes factor.  It has no window, so it cannot empty a section;
what it has instead is an *explanation*, channel by channel, of why a pair was
accepted, and a posterior probability that accounts for every rival candidate
the pair had to beat.

The four stages
---------------
1. **Drift discovery.**  Every OLD defect votes for every NEW defect by the
   displacement between them.  Real displacement is shared — a section shifted
   by +3.4 m shifts all of its defects by roughly +3.4 m — so genuine pairs pile
   up at one value while coincidental ones scatter.  The tallest pile is the
   drift.  This is a one-dimensional Hough vote, and it is the step that makes a
   metres-wide shift harmless instead of fatal.  An optional robust (Theil–Sen)
   slope then catches a stretched odometer as well as a shifted one.

2. **Noise scale from the data.**  The residual spread of the voting defects,
   via the median absolute deviation, becomes sigma.  Nothing here comes from a
   slider: a tight run gets a tight sigma and a sloppy run gets a loose one.

3. **Evidence, per channel.**  Position, weld-relative distance, clock, length
   and width each contribute a log-likelihood ratio between "same defect" and
   "coincidence".  The coincidence model is not a straw man — it is the actual
   distribution of the quantity across the section, so a channel that cannot
   discriminate (every defect at 6 o'clock) contributes almost nothing rather
   than free confidence.  Depth is deliberately absent: it is the growth
   measurement the alignment exists to produce, and letting it select pairs
   would make the answer circular.

4. **Assignment and posterior.**  An order-preserving dynamic program picks the
   set of pairs with the greatest total evidence — order-preserving because
   defects on a pipe cannot swap places.  The posterior of each accepted pair is
   then taken against all of its rivals on both sides, so a pair that was the
   only plausible reading scores high and a pair that narrowly beat two lookalikes
   does not.

Optionally a Monte-Carlo permutation test re-runs the whole pipeline against
synthetic sections of the same defect density, which turns "log Bayes factor
11.8" into "no random section in 200 produced evidence this strong".

Everything here is pure: no database, no session, no engine.  ``bayesian_engine``
adapts run features into :class:`Observation` values and feeds them in.
"""

from __future__ import annotations

import bisect
import math
import random
from dataclasses import dataclass, field, replace

LOG_SQRT_2PI = 0.5 * math.log(2.0 * math.pi)

# One channel can never be worth more than this many nats, in either direction.
# Without it a mis-estimated sigma on one field (a run reporting every length as
# exactly 100 mm, say) would swamp the four honest channels beside it.
CHANNEL_LOG_LR_CAP = 12.0

# Densities are floored before the logarithm so an impossible-but-observed value
# costs a large finite penalty instead of -inf, which would make the whole pair
# unrepresentable and hide the other channels' evidence from the report.
DENSITY_FLOOR = 1e-12


@dataclass(frozen=True)
class Observation:
    """One defect, as the matcher sees it.

    ``position`` is metres on whichever axis the caller chose to compare in;
    this module never transforms it.  Every other field is optional, and a
    ``None`` simply means that channel contributes no evidence for this defect.
    """

    index: int
    position: float
    weld_distance: float | None = None
    clock_deg: float | None = None
    length_mm: float | None = None
    width_mm: float | None = None


@dataclass(frozen=True)
class MatcherConfig:
    """Physical priors. None of these is a tolerance — none of them rejects a pair.

    Sigmas describe how precisely a channel is *measured*; the drift bandwidth
    describes how wide a vote window the section deserves.  Widening any of them
    makes the matcher less discriminating, never more permissive about a gate,
    because there is no gate.
    """

    # Half-width of the displacement vote window.  Wide enough to hold the
    # genuine pairs of a section together, narrow enough that two unrelated
    # clusters do not merge into one pile.
    drift_bandwidth_m: float = 0.75
    # Largest displacement worth considering, or None for "anything inside the
    # section".  A locked GW section is already bounded, so None is usual.
    max_drift_m: float | None = None
    min_sigma_m: float = 0.05
    max_sigma_m: float = 3.0
    # Purely computational: candidate pairs beyond this many sigmas contribute
    # a log Bayes factor so negative they could never be selected, so they are
    # not enumerated.  Raising it changes runtime, not results.
    search_sigmas: float = 6.0

    weld_sigma_m: float = 0.10
    joint_length_m: float = 12.0
    clock_sigma_deg: float = 12.0
    # Corrosion grows.  A defect reported 40 mm longer than last time is
    # ordinary; one reported 40 mm shorter is either a re-measurement or a
    # different defect, so shrinkage is held to a tighter distribution.
    length_shrink_sigma_mm: float = 20.0
    length_growth_sigma_mm: float = 60.0
    width_shrink_sigma_mm: float = 25.0
    width_growth_sigma_mm: float = 75.0

    # Prior probability that an OLD defect is still present and reported in the
    # NEW run.  0.5 is the neutral choice and makes the score a pure Bayes factor.
    prior_match_probability: float = 0.5
    # Evidence a pair must carry to be selected at all.  Zero means "the same
    # defect must be a better explanation than coincidence" — the natural
    # threshold, and the reason this matcher needs no distance window.  Raising
    # it demands more.  Lowering it below zero does nothing and is rejected by
    # the engine rather than offered as a knob: the solver maximises a *sum* of
    # scores, so a negative-scoring pair always makes its chain worse and is
    # dropped whatever the threshold says.
    accept_log_bayes_factor: float = 0.0

    allow_scale: bool = True
    max_scale_deviation: float = 0.02

    permutation_trials: int = 0
    permutation_seed: int = 20260810
    # Guards both the candidate enumeration and the permutation budget on the
    # sections large enough to matter.
    max_candidate_edges: int = 200_000
    max_permutation_cells: int = 2_000_000
    # Ceiling on the quadratic displacement vote. Beyond it both runs are
    # strided down; the support count and sigma are still measured against every
    # defect, so only the search for the displacement is thinned.
    max_vote_pairs: int = 400_000

    def log_prior_odds(self) -> float:
        probability = min(max(self.prior_match_probability, 1e-6), 1 - 1e-6)
        return math.log(probability / (1.0 - probability))


@dataclass(frozen=True)
class DriftEstimate:
    """The displacement model this section's two runs appear to differ by."""

    shift_m: float
    scale: float
    reference_m: float
    sigma_m: float
    support: int
    candidates: int
    bandwidth_m: float
    scale_applied: bool

    def predict(self, position: float) -> float:
        """Where an OLD defect at ``position`` should appear in the NEW run."""
        return self.reference_m + self.scale * (position - self.reference_m) + self.shift_m


@dataclass(frozen=True)
class Channel:
    """One line of the calculation, as numbers only.

    Deliberately carries no prose. This object is attached to every matched row
    and stored with it, so a sentence here is a sentence written once per pair
    into the results table — on a 60,000-pair comparison that is the difference
    between a compact payload and tens of megabytes of repeated English. The
    wording lives in the drawer that renders it; ``null_spread`` is the one
    number the wording needs.
    """

    name: str
    unit: str
    observed: float
    spread: float
    #: Spread of this quantity under the coincidence hypothesis, in the same unit.
    null_spread: float
    log_lr: float
    #: False when the section cannot discriminate on this channel, in which case
    #: ``log_lr`` is zero by construction rather than by coincidence.
    informative: bool = True


@dataclass(frozen=True)
class Candidate:
    old_index: int
    new_index: int
    log_bayes_factor: float
    channels: tuple[Channel, ...]
    residual_m: float


@dataclass
class SegmentMatch:
    pairs: list[dict] = field(default_factory=list)
    drift: DriftEstimate | None = None
    total_log_bayes_factor: float = 0.0
    candidates_considered: int = 0
    permutation_trials: int = 0
    permutation_p_value: float | None = None
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Small numeric helpers
# ---------------------------------------------------------------------------

def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return 0.5 * (ordered[middle - 1] + ordered[middle])


def _median_absolute_deviation(values: list[float]) -> float:
    if not values:
        return 0.0
    centre = _median(values)
    return _median([abs(value - centre) for value in values])


def _log_sum_exp(values: list[float]) -> float:
    if not values:
        return -math.inf
    highest = max(values)
    if highest == -math.inf:
        return -math.inf
    return highest + math.log(sum(math.exp(value - highest) for value in values))


def _log_normal_density(value: float, sigma: float) -> float:
    sigma = max(sigma, 1e-9)
    return -0.5 * (value / sigma) ** 2 - math.log(sigma) - LOG_SQRT_2PI


def _log_folded_normal_density(magnitude: float, sigma: float) -> float:
    """Density of |X| where X ~ N(0, sigma^2); the input is already >= 0."""
    return math.log(2.0) + _log_normal_density(abs(magnitude), sigma)


def _log_two_piece_normal_density(value: float, sigma_below: float, sigma_above: float) -> float:
    """Gaussian with one spread below zero and another above it.

    Properly normalised: the two half-densities integrate to
    ``sigma_below / (sigma_below + sigma_above)`` and its complement.
    """
    sigma_below = max(sigma_below, 1e-9)
    sigma_above = max(sigma_above, 1e-9)
    sigma = sigma_below if value < 0 else sigma_above
    return (
        math.log(2.0 / (sigma_below + sigma_above))
        - 0.5 * (value / sigma) ** 2
        - LOG_SQRT_2PI
    )


def _log_triangular_difference_density(difference: float, half_width: float) -> float:
    """Density of X - Y for independent X, Y uniform on a range ``half_width``.

    This is the honest null for "two unrelated defects": their reported values
    are not equally likely to differ by anything, they are most likely to differ
    by little simply because both are drawn from the same bounded population.
    Using a flat null instead would credit every near-agreement as evidence.
    """
    half_width = max(half_width, 1e-9)
    magnitude = min(abs(difference), half_width)
    density = (half_width - magnitude) / (half_width * half_width)
    return math.log(max(density, DENSITY_FLOOR))


def _capped(value: float) -> float:
    return max(-CHANNEL_LOG_LR_CAP, min(CHANNEL_LOG_LR_CAP, value))


def _discriminates(measurement_spread: float, population_spread: float) -> bool:
    """Whether this channel can tell two defects in this section apart at all.

    A channel is only evidence when the measurement is finer than the population
    it has to discriminate within.  Where it is not — every defect in the section
    is 25 mm wide, and the tool sizes width to ±75 mm — agreement means nothing,
    and the likelihood ratio has to be reported as nothing.

    Without this the arithmetic misfires in a way that is easy to miss and hard
    to defend to an engineer: the same-defect density at zero difference is
    *lower* than the coincidence density (a wide Gaussian is flat where a narrow
    triangle is tall), so two defects agreeing perfectly on width score evidence
    *against* being the same defect.  The maths is right and the conclusion is
    absurd, because the model was asked a question the data cannot answer.
    """
    return population_spread > measurement_spread


def _observed_range(values: list[float], floor: float) -> float:
    finite = [value for value in values if value is not None and math.isfinite(value)]
    if len(finite) < 2:
        return floor
    return max(max(finite) - min(finite), floor)


def _clock_difference_deg(first: float, second: float) -> float:
    difference = abs(first - second) % 360.0
    return min(difference, 360.0 - difference)


# ---------------------------------------------------------------------------
# Stage 1 — drift discovery
# ---------------------------------------------------------------------------

def _thin_for_vote(
    old_positions: list[float],
    new_positions: list[float],
    config: MatcherConfig,
) -> tuple[list[float], list[float]]:
    """Both position lists, strided down until their product fits the budget."""
    budget = max(config.max_vote_pairs, 1)
    if len(old_positions) * len(new_positions) <= budget:
        return old_positions, new_positions
    # One stride on both sides keeps the two runs sampled the same way, so a
    # genuine shared displacement still lines up in the thinned sets.
    stride = 1
    while (
        (len(old_positions) + stride - 1) // stride
        * ((len(new_positions) + stride - 1) // stride)
    ) > budget:
        stride += 1
    return old_positions[::stride], new_positions[::stride]


def estimate_drift(
    old_positions: list[float],
    new_positions: list[float],
    config: MatcherConfig,
) -> DriftEstimate:
    """Find the displacement the two runs share, by pairwise-difference voting.

    Every OLD defect proposes a displacement to every NEW defect.  Genuine pairs
    all propose roughly the same value; coincidental ones propose noise.  The
    densest window of proposals is therefore the section's real displacement,
    and it is found without assuming the displacement is small.
    """
    reference = _median(old_positions) if old_positions else 0.0
    empty = DriftEstimate(
        shift_m=0.0, scale=1.0, reference_m=reference,
        sigma_m=config.min_sigma_m, support=0, candidates=0,
        bandwidth_m=config.drift_bandwidth_m, scale_applied=False,
    )
    if not old_positions or not new_positions:
        return empty

    limit = config.max_drift_m
    # The vote is quadratic in the segment size, so a section with thousands of
    # defects per run would otherwise build tens of millions of proposals before
    # anything else ran.  Both runs are thinned by a deterministic stride
    # instead: the displacement is a property of the section, not of any
    # particular defect, so a fifth of the defects locate it just as well — and a
    # stride keeps the result reproducible where sampling would not.
    old_sample, new_sample = _thin_for_vote(old_positions, new_positions, config)

    deltas = []
    for old_position in old_sample:
        for new_position in new_sample:
            delta = new_position - old_position
            if limit is None or abs(delta) <= limit:
                deltas.append(delta)
    if not deltas:
        return empty
    deltas.sort()

    # Widest-support window of width 2 * bandwidth, by two pointers over the
    # sorted proposals.  Ties break towards the window closest to zero: with no
    # evidence either way, the run that did not drift is the better assumption.
    bandwidth = max(config.drift_bandwidth_m, 1e-6)
    best_start = 0
    best_end = 0
    best_count = 0
    best_centre = 0.0
    start = 0
    for end, delta in enumerate(deltas):
        while delta - deltas[start] > 2 * bandwidth:
            start += 1
        count = end - start + 1
        centre = 0.5 * (deltas[start] + delta)
        if count > best_count or (count == best_count and abs(centre) < abs(best_centre)):
            best_count = count
            best_start = start
            best_centre = centre
            best_end = end
    window = deltas[best_start:best_end + 1]
    shift = _median(window)

    # The vote counted every proposal, including several from the same defect.
    # Support and sigma must come from one proposal per OLD defect: its nearest
    # NEW neighbour under the shift.  Otherwise a dense cluster of NEW defects
    # inflates both.
    sorted_new = sorted(new_positions)
    anchors = []
    for old_position in old_positions:
        predicted = old_position + shift
        insertion = bisect.bisect_left(sorted_new, predicted)
        nearest = None
        for candidate_index in (insertion - 1, insertion):
            if 0 <= candidate_index < len(sorted_new):
                candidate = sorted_new[candidate_index]
                if nearest is None or abs(candidate - predicted) < abs(nearest - predicted):
                    nearest = candidate
        if nearest is not None and abs(nearest - predicted) <= bandwidth:
            anchors.append((old_position, nearest))

    residuals = [new - (old + shift) for old, new in anchors]
    sigma = 1.4826 * _median_absolute_deviation(residuals) if residuals else 0.0
    sigma = min(max(sigma, config.min_sigma_m), config.max_sigma_m)

    scale = 1.0
    scale_applied = False
    if config.allow_scale and len(anchors) >= 4:
        scale_candidate = _theil_sen_slope(anchors)
        # A slope of exactly 1 is the null result, not a correction. Adopting it
        # anyway set `scale_applied` on a section that never stretched, and the
        # evidence drawer then told the reviewer about a "x1.00000 scale" it had
        # supposedly applied.
        if (
            scale_candidate is not None
            and abs(scale_candidate - 1.0) > 1e-9
            and abs(scale_candidate - 1.0) <= config.max_scale_deviation
        ):
            scaled_residuals = [
                new - (reference + scale_candidate * (old - reference) + shift)
                for old, new in anchors
            ]
            # Only accepted when it genuinely tightens the fit.  A slope fitted
            # to noise would otherwise be applied across the whole section.
            scaled_sigma = 1.4826 * _median_absolute_deviation(scaled_residuals)
            if scaled_sigma < sigma * 0.9:
                # Re-centre the shift on the scaled model before adopting it.
                shift = _median([
                    new - (reference + scale_candidate * (old - reference))
                    for old, new in anchors
                ])
                scale = scale_candidate
                sigma = min(max(scaled_sigma, config.min_sigma_m), config.max_sigma_m)
                scale_applied = True

    return DriftEstimate(
        shift_m=shift,
        scale=scale,
        reference_m=reference,
        sigma_m=sigma,
        support=len(anchors),
        candidates=len(deltas),
        bandwidth_m=bandwidth,
        scale_applied=scale_applied,
    )


def _theil_sen_slope(anchors: list[tuple[float, float]]) -> float | None:
    """Median pairwise slope — a fit that a third of bad anchors cannot move."""
    count = len(anchors)
    if count < 4:
        return None
    # Deterministic stride keeps the pair count bounded on dense sections
    # without introducing randomness into an otherwise reproducible result.
    stride = max(1, count // 120)
    sampled = anchors[::stride]
    slopes = []
    for first in range(len(sampled)):
        for second in range(first + 1, len(sampled)):
            run = sampled[second][0] - sampled[first][0]
            if abs(run) < 1e-9:
                continue
            slopes.append((sampled[second][1] - sampled[first][1]) / run)
    if len(slopes) < 3:
        return None
    return _median(slopes)


# ---------------------------------------------------------------------------
# Stage 3 — per-pair evidence
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class _NullModel:
    """Spread of each quantity across the section, i.e. what coincidence looks like."""

    position_span_m: float
    joint_length_m: float
    length_range_mm: float
    width_range_mm: float


def build_null_model(
    old_observations: list[Observation],
    new_observations: list[Observation],
    config: MatcherConfig,
    span_m: float | None = None,
) -> _NullModel:
    positions = [item.position for item in old_observations + new_observations]
    span = span_m if span_m and span_m > 0 else _observed_range(positions, 1.0)
    lengths = [item.length_mm for item in old_observations + new_observations]
    widths = [item.width_mm for item in old_observations + new_observations]
    return _NullModel(
        position_span_m=max(span, 1.0),
        joint_length_m=max(config.joint_length_m, 1.0),
        length_range_mm=_observed_range(lengths, 10.0),
        width_range_mm=_observed_range(widths, 10.0),
    )


def score_pair(
    old_observation: Observation,
    new_observation: Observation,
    drift: DriftEstimate,
    null_model: _NullModel,
    config: MatcherConfig,
) -> Candidate:
    """The log Bayes factor for one candidate pair, channel by channel."""
    channels: list[Channel] = []

    predicted = drift.predict(old_observation.position)
    residual = new_observation.position - predicted
    position_informative = _discriminates(drift.sigma_m, null_model.position_span_m)
    position_log_lr = _capped(
        _log_normal_density(residual, drift.sigma_m)
        - math.log(1.0 / null_model.position_span_m)
    ) if position_informative else 0.0
    channels.append(Channel(
        name="Position",
        unit="m",
        observed=residual,
        spread=drift.sigma_m,
        null_spread=null_model.position_span_m,
        log_lr=position_log_lr,
        informative=position_informative,
    ))

    if old_observation.weld_distance is not None and new_observation.weld_distance is not None:
        difference = abs(abs(old_observation.weld_distance) - abs(new_observation.weld_distance))
        weld_informative = _discriminates(config.weld_sigma_m, null_model.joint_length_m)
        weld_log_lr = _capped(
            _log_folded_normal_density(difference, config.weld_sigma_m)
            - _log_triangular_difference_density(difference, null_model.joint_length_m)
            - math.log(2.0)  # the null is folded to |difference| as well
        ) if weld_informative else 0.0
        channels.append(Channel(
            name="U/S weld distance",
            unit="m",
            observed=difference,
            spread=config.weld_sigma_m,
            null_spread=null_model.joint_length_m,
            log_lr=weld_log_lr,
            informative=weld_informative,
        ))

    if old_observation.clock_deg is not None and new_observation.clock_deg is not None:
        difference = _clock_difference_deg(old_observation.clock_deg, new_observation.clock_deg)
        clock_informative = _discriminates(config.clock_sigma_deg, 180.0)
        clock_log_lr = _capped(
            _log_folded_normal_density(difference, config.clock_sigma_deg)
            - math.log(1.0 / 180.0)
        ) if clock_informative else 0.0
        channels.append(Channel(
            name="Clock",
            unit="deg",
            observed=difference,
            spread=config.clock_sigma_deg,
            null_spread=180.0,
            log_lr=clock_log_lr,
            informative=clock_informative,
        ))

    if old_observation.length_mm is not None and new_observation.length_mm is not None:
        difference = new_observation.length_mm - old_observation.length_mm
        length_informative = _discriminates(
            config.length_shrink_sigma_mm, null_model.length_range_mm,
        )
        length_log_lr = _capped(
            _log_two_piece_normal_density(
                difference, config.length_shrink_sigma_mm, config.length_growth_sigma_mm,
            )
            - _log_triangular_difference_density(difference, null_model.length_range_mm)
        ) if length_informative else 0.0
        channels.append(Channel(
            name="Length",
            unit="mm",
            observed=difference,
            spread=(
                config.length_shrink_sigma_mm if difference < 0
                else config.length_growth_sigma_mm
            ),
            null_spread=null_model.length_range_mm,
            log_lr=length_log_lr,
            informative=length_informative,
        ))

    if old_observation.width_mm is not None and new_observation.width_mm is not None:
        difference = new_observation.width_mm - old_observation.width_mm
        width_informative = _discriminates(
            config.width_shrink_sigma_mm, null_model.width_range_mm,
        )
        width_log_lr = _capped(
            _log_two_piece_normal_density(
                difference, config.width_shrink_sigma_mm, config.width_growth_sigma_mm,
            )
            - _log_triangular_difference_density(difference, null_model.width_range_mm)
        ) if width_informative else 0.0
        channels.append(Channel(
            name="Width",
            unit="mm",
            observed=difference,
            spread=(
                config.width_shrink_sigma_mm if difference < 0
                else config.width_growth_sigma_mm
            ),
            null_spread=null_model.width_range_mm,
            log_lr=width_log_lr,
            informative=width_informative,
        ))

    total = config.log_prior_odds() + sum(channel.log_lr for channel in channels)
    return Candidate(
        old_index=old_observation.index,
        new_index=new_observation.index,
        log_bayes_factor=total,
        channels=tuple(channels),
        residual_m=residual,
    )


def build_candidates(
    old_observations: list[Observation],
    new_observations: list[Observation],
    drift: DriftEstimate,
    null_model: _NullModel,
    config: MatcherConfig,
) -> list[Candidate]:
    """Score every pair close enough to be worth scoring.

    The search radius is ``search_sigmas`` times the *measured* sigma, so it
    widens by itself on a noisy section instead of being set by an engineer.  It
    is a compute bound, not a gate: a pair outside it scores so far below the
    coincidence hypothesis that it could not be selected anyway.
    """
    if not old_observations or not new_observations:
        return []
    radius = max(config.search_sigmas * drift.sigma_m, drift.bandwidth_m)
    ordered_new = sorted(new_observations, key=lambda item: item.position)
    new_positions = [item.position for item in ordered_new]

    candidates: list[Candidate] = []
    for old_observation in old_observations:
        predicted = drift.predict(old_observation.position)
        first = bisect.bisect_left(new_positions, predicted - radius)
        last = bisect.bisect_right(new_positions, predicted + radius)
        for offset in range(first, last):
            candidate = score_pair(
                old_observation, ordered_new[offset], drift, null_model, config,
            )
            candidates.append(candidate)
            if len(candidates) >= config.max_candidate_edges:
                return candidates
    return candidates


# ---------------------------------------------------------------------------
# Stage 4 — assignment and posterior
# ---------------------------------------------------------------------------

def solve_max_score_monotonic(
    old_count: int,
    new_count: int,
    candidates: list[Candidate],
    minimum_score: float,
) -> list[Candidate]:
    """Highest total evidence, without letting two pairs cross.

    Defects do not swap places along a pipe, so a valid set of pairs must
    increase on both runs.  Unlike the tolerance-gated solver this does *not*
    maximise the number of pairs first: an extra pair that carries barely any
    evidence is not worth taking, and forcing cardinality is exactly how a
    matcher invents identities for defects that simply are not there.
    """
    eligible = [item for item in candidates if item.log_bayes_factor > minimum_score]
    if not eligible or old_count == 0 or new_count == 0:
        return []

    eligible.sort(key=lambda item: (item.old_index, item.new_index))

    # Fenwick tree over NEW indexes holding the best score achievable using only
    # NEW columns strictly to the left, so each candidate is extended in
    # O(log n) instead of scanning every earlier choice.
    best_score = [0.0] * (new_count + 1)
    best_state = [None] * (new_count + 1)

    def query(column: int):
        """Best (score, state) over NEW columns < ``column``."""
        score = 0.0
        state = None
        index = column
        while index > 0:
            if best_score[index] > score:
                score = best_score[index]
                state = best_state[index]
            index -= index & -index
        return score, state

    def update(column: int, score: float, state):
        index = column + 1
        while index <= new_count:
            if score > best_score[index]:
                best_score[index] = score
                best_state[index] = state
            index += index & -index

    states: list[tuple[float, Candidate, object]] = []
    best_total = 0.0
    best_final = None
    cursor = 0
    while cursor < len(eligible):
        row = eligible[cursor].old_index
        pending = []
        while cursor < len(eligible) and eligible[cursor].old_index == row:
            candidate = eligible[cursor]
            previous_score, previous_state = query(candidate.new_index)
            total = previous_score + candidate.log_bayes_factor
            state = (total, candidate, previous_state)
            states.append(state)
            pending.append((candidate.new_index, total, state))
            if total > best_total:
                best_total = total
                best_final = state
            cursor += 1
        for column, total, state in pending:
            update(column, total, state)

    chosen: list[Candidate] = []
    state = best_final
    while state is not None:
        _total, candidate, previous = state
        chosen.append(candidate)
        state = previous
    chosen.reverse()
    return chosen


def posterior_probabilities(candidates: list[Candidate]) -> dict[tuple[int, int], dict]:
    """Posterior for each candidate against every rival it had, on both sides.

    ``exp(log Bayes factor)`` is already the odds of this pair against the
    coincidence hypothesis, so the "no match" option enters each normalisation
    with weight 1.  Taking the smaller of the OLD-side and NEW-side posteriors is
    the conservative reading: a pair is only confident when it is the best
    explanation of *both* defects, not merely the best partner for one of them.
    """
    by_old: dict[int, list[float]] = {}
    by_new: dict[int, list[float]] = {}
    for candidate in candidates:
        by_old.setdefault(candidate.old_index, []).append(candidate.log_bayes_factor)
        by_new.setdefault(candidate.new_index, []).append(candidate.log_bayes_factor)

    result: dict[tuple[int, int], dict] = {}
    for candidate in candidates:
        row = by_old[candidate.old_index]
        column = by_new[candidate.new_index]
        # log(1 + sum(exp(scores))) — the 1 is the "these are different defects"
        # hypothesis, which never disappears however good the alternatives look.
        row_total = _log_sum_exp([0.0] + row)
        column_total = _log_sum_exp([0.0] + column)
        row_posterior = math.exp(candidate.log_bayes_factor - row_total)
        column_posterior = math.exp(candidate.log_bayes_factor - column_total)
        result[(candidate.old_index, candidate.new_index)] = {
            "posterior": min(row_posterior, column_posterior),
            "oldSidePosterior": row_posterior,
            "newSidePosterior": column_posterior,
            "oldSideRivals": len(row) - 1,
            "newSideRivals": len(column) - 1,
        }
    return result


# ---------------------------------------------------------------------------
# Monte-Carlo calibration
# ---------------------------------------------------------------------------

def permutation_p_value(
    old_observations: list[Observation],
    new_observations: list[Observation],
    config: MatcherConfig,
    observed_total: float,
    span_m: float | None = None,
) -> tuple[float | None, int]:
    """How often a section of pure coincidence would look this convincing.

    The synthetic NEW run keeps the real defect count and the real marginal
    distribution of every attribute, and only destroys the association between
    them and their positions.  If the matcher still finds this much evidence in
    such a section, the evidence was an artefact of density rather than identity.

    Returns ``(p_value, trials_run)``; ``(None, 0)`` when the section is too
    large for the budget, which the caller reports rather than hides.
    """
    trials = int(config.permutation_trials)
    if trials <= 0 or not old_observations or not new_observations:
        return None, 0
    cells = len(old_observations) * len(new_observations) * trials
    if cells > config.max_permutation_cells:
        return None, 0

    positions = [item.position for item in new_observations]
    lowest, highest = min(positions), max(positions)
    if highest <= lowest:
        return None, 0

    attributes = [
        (item.weld_distance, item.clock_deg, item.length_mm, item.width_mm)
        for item in new_observations
    ]
    generator = random.Random(config.permutation_seed)
    # No permutation test inside a permutation test.
    trial_config = replace(config, permutation_trials=0)

    at_least_as_extreme = 0
    for _trial in range(trials):
        sampled = sorted(generator.uniform(lowest, highest) for _ in range(len(new_observations)))
        shuffled = list(attributes)
        generator.shuffle(shuffled)
        synthetic = [
            Observation(
                index=index,
                position=position,
                weld_distance=values[0],
                clock_deg=values[1],
                length_mm=values[2],
                width_mm=values[3],
            )
            for index, (position, values) in enumerate(zip(sampled, shuffled))
        ]
        outcome = match_observations(old_observations, synthetic, trial_config, span_m)
        if outcome.total_log_bayes_factor >= observed_total:
            at_least_as_extreme += 1

    # The +1 on both sides is the standard finite-sample correction: with 200
    # trials and no hit, the honest answer is "below 1/201", not "zero".
    return (at_least_as_extreme + 1) / (trials + 1), trials


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def match_observations(
    old_observations: list[Observation],
    new_observations: list[Observation],
    config: MatcherConfig,
    span_m: float | None = None,
) -> SegmentMatch:
    """Run the whole pipeline over one section and return its pairs and evidence."""
    outcome = SegmentMatch()
    if not old_observations or not new_observations:
        outcome.notes.append("Section has defects on one side only; nothing to match.")
        return outcome

    drift = estimate_drift(
        [item.position for item in old_observations],
        [item.position for item in new_observations],
        config,
    )
    outcome.drift = drift
    if drift.support == 0:
        outcome.notes.append(
            "No shared displacement could be found; the two runs' defects do not "
            "line up at any offset."
        )

    null_model = build_null_model(old_observations, new_observations, config, span_m)
    candidates = build_candidates(old_observations, new_observations, drift, null_model, config)
    outcome.candidates_considered = len(candidates)
    if len(candidates) >= config.max_candidate_edges:
        outcome.notes.append(
            f"Candidate enumeration stopped at {config.max_candidate_edges:,} pairs; "
            "some far-outlying pairs were not scored."
        )

    old_count = max((item.index for item in old_observations), default=-1) + 1
    new_count = max((item.index for item in new_observations), default=-1) + 1
    selected = solve_max_score_monotonic(
        old_count, new_count, candidates, config.accept_log_bayes_factor,
    )
    statistics = posterior_probabilities(candidates)

    outcome.total_log_bayes_factor = sum(item.log_bayes_factor for item in selected)
    outcome.pairs = [
        {
            "old_index": candidate.old_index,
            "new_index": candidate.new_index,
            "log_bayes_factor": candidate.log_bayes_factor,
            "residual_m": candidate.residual_m,
            "channels": [
                {
                    "name": channel.name,
                    "unit": channel.unit,
                    "observed": channel.observed,
                    "spread": channel.spread,
                    "nullSpread": channel.null_spread,
                    "logLikelihoodRatio": channel.log_lr,
                    "informative": channel.informative,
                }
                for channel in candidate.channels
            ],
            **statistics.get((candidate.old_index, candidate.new_index), {}),
        }
        for candidate in selected
    ]

    p_value, trials = permutation_p_value(
        old_observations, new_observations, config,
        outcome.total_log_bayes_factor, span_m,
    )
    outcome.permutation_p_value = p_value
    outcome.permutation_trials = trials
    if config.permutation_trials > 0 and trials == 0:
        outcome.notes.append(
            "Monte-Carlo calibration was skipped: this section exceeds the "
            "permutation budget."
        )
    return outcome

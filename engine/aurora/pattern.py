"""Relative geometry, motifs, density and regions (sections 13 to 16).

The core idea for a severely mismatched pair is to compare *relationships*
between corrosion points instead of their absolute positions.  A common axial
translation and clock rotation cancel out of pairwise differences, which is the
mathematical reason a pattern stays identifiable even when every individual
point violates a traditional tolerance window.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .canonical import CanonicalFeature, wrap
from .config import PatternConfig


@dataclass
class PatternPoint:
    """One metal-loss feature in local cylindrical coordinates."""

    feature: CanonicalFeature
    u: float
    theta: float | None

    @property
    def key(self) -> str:
        return self.feature.key


@dataclass
class PatternRegion:
    """An algorithmic corrosion region, independent of vendor cluster labels."""

    region_id: str
    side: str
    pjid: str
    members: list[PatternPoint] = field(default_factory=list)

    @property
    def u_extent(self) -> tuple[float, float]:
        values = [point.u for point in self.members]
        return (min(values), max(values)) if values else (0.0, 0.0)

    def to_dict(self) -> dict:
        low, high = self.u_extent
        return {
            "regionId": self.region_id,
            "side": self.side,
            "pjid": self.pjid,
            "members": len(self.members),
            "uFrom": round(low, 4),
            "uTo": round(high, 4),
        }


def build_points(features: list[CanonicalFeature]) -> list[PatternPoint]:
    """Metal-loss features that carry a usable local coordinate.

    Clock may be missing; that removes circumferential evidence but does not
    remove the feature, which is what the availability mask is for.  A missing
    ``u`` does remove it: without a local coordinate there is no geometry to
    compare.
    """
    return [
        PatternPoint(feature=feature, u=feature.u, theta=feature.clock_rad)
        for feature in features
        if feature.u is not None and math.isfinite(feature.u)
    ]


def neighbour_descriptors(
    points: list[PatternPoint], config: PatternConfig
) -> list[list[tuple[float, float]]]:
    """``G_i``: sorted relative vectors to the k nearest neighbours (section 14.1).

    Neighbours are taken in normalised axial distance, and the circumferential
    component is carried alongside rather than mixed into one metric: the two
    axes have different units and different reliabilities.
    """
    if not points:
        return []
    order = sorted(range(len(points)), key=lambda index: points[index].u)
    descriptors: list[list[tuple[float, float]]] = [[] for _ in points]
    for position, index in enumerate(order):
        window: list[tuple[float, float]] = []
        for offset in range(1, config.neighbours + 1):
            for neighbour_position in (position - offset, position + offset):
                if not (0 <= neighbour_position < len(order)):
                    continue
                other = points[order[neighbour_position]]
                delta_u = other.u - points[index].u
                delta_theta = (
                    wrap(other.theta - points[index].theta)
                    if other.theta is not None and points[index].theta is not None
                    else 0.0
                )
                window.append((delta_u, delta_theta))
        descriptors[index] = sorted(window, key=lambda item: abs(item[0]))[
            : config.neighbours
        ]
    return descriptors


def descriptor_similarity(
    left: list[tuple[float, float]],
    right: list[tuple[float, float]],
    config: PatternConfig,
) -> float:
    """How alike two neighbourhoods are, under translation and rotation.

    Both descriptors are already differences, so a common shift and a common
    rotation have cancelled before this is called.  What remains is whether the
    two points sit in the same local constellation.
    """
    if not left or not right:
        return 0.0
    total = 0.0
    for delta_u, delta_theta in left:
        best = 0.0
        for other_u, other_theta in right:
            axial = (delta_u - other_u) / max(config.vote_bandwidth_u, 1e-9)
            circumferential = wrap(delta_theta - other_theta) / max(
                config.vote_bandwidth_rad, 1e-9
            )
            best = max(best, math.exp(-0.5 * (axial * axial + circumferential * circumferential)))
        total += best
    return total / len(left)


def _point_distance(left: PatternPoint, right: PatternPoint) -> float:
    delta_u = right.u - left.u
    delta_theta = (
        wrap(right.theta - left.theta)
        if left.theta is not None and right.theta is not None
        else 0.0
    )
    # The two axes are normalised differently on purpose: ``u`` is already
    # dimensionless and the angle is in radians, so the angle is scaled to a
    # comparable span rather than being treated as metres.
    return math.hypot(delta_u, delta_theta / (2.0 * math.pi))


def density_map(
    points: list[PatternPoint],
    bins_u: int = 24,
    bins_theta: int = 12,
) -> np.ndarray:
    """Smoothed occupancy on the unwrapped local grid (section 14.3).

    One tool may report a corrosion patch as one box and another as fifteen, so
    comparing smoothed density is often the only representation in which the
    two populations look alike at all.
    """
    grid = np.zeros((bins_u, bins_theta), dtype=float)
    if not points:
        return grid
    for point in points:
        u_bin = min(bins_u - 1, max(0, int(point.u * bins_u)))
        if point.theta is None:
            grid[u_bin, :] += 1.0 / bins_theta
            continue
        theta_bin = min(
            bins_theta - 1, max(0, int((point.theta / (2.0 * math.pi)) * bins_theta))
        )
        grid[u_bin, theta_bin] += 1.0
    return _smooth(grid)


def _smooth(grid: np.ndarray) -> np.ndarray:
    """Separable 1-2-1 blur, wrapping circumferentially and clamping axially."""
    kernel = np.array([1.0, 2.0, 1.0])
    kernel = kernel / kernel.sum()
    blurred = np.apply_along_axis(
        lambda row: np.convolve(np.pad(row, 1, mode="wrap"), kernel, mode="same")[1:-1],
        axis=1,
        arr=grid,
    )
    blurred = np.apply_along_axis(
        lambda column: np.convolve(np.pad(column, 1, mode="edge"), kernel, mode="same")[1:-1],
        axis=0,
        arr=blurred,
    )
    return blurred


def density_correlation(left: np.ndarray, right: np.ndarray) -> float:
    """Normalised cross-correlation of two density maps, in ``[0, 1]``."""
    left_flat = left.ravel()
    right_flat = right.ravel()
    left_norm = float(np.linalg.norm(left_flat))
    right_norm = float(np.linalg.norm(right_flat))
    if left_norm <= 1e-12 or right_norm <= 1e-12:
        return 0.0
    return float(np.clip(np.dot(left_flat, right_flat) / (left_norm * right_norm), 0.0, 1.0))


def chamfer_distance(left: list[PatternPoint], right: list[PatternPoint]) -> float:
    """Symmetric mean nearest-neighbour distance (section 16.1)."""
    if not left or not right:
        return math.inf
    forward = sum(
        min(_point_distance(point, other) for other in right) for point in left
    ) / len(left)
    backward = sum(
        min(_point_distance(point, other) for other in left) for point in right
    ) / len(right)
    return forward + backward


def build_regions(
    points: list[PatternPoint],
    pjid: str,
    side: str,
    config: PatternConfig,
) -> list[PatternRegion]:
    """Connected components in corrected cylindrical space (section 16).

    Regions are algorithmic and independent of the vendor's own cluster labels,
    which are kept as evidence elsewhere but never define the region here — the
    grouping is exactly what changes between runs.
    """
    regions: list[PatternRegion] = []
    if not points:
        return regions

    order = sorted(range(len(points)), key=lambda index: points[index].u)
    current: list[PatternPoint] = []
    previous: PatternPoint | None = None
    counter = 0

    def flush() -> None:
        nonlocal current, counter
        if not current:
            return
        counter += 1
        regions.append(PatternRegion(
            region_id=f"{pjid}:{side}:R{counter}",
            side=side,
            pjid=pjid,
            members=list(current),
        ))
        current = []

    for index in order:
        point = points[index]
        if previous is None:
            current = [point]
        else:
            axial_gap = point.u - previous.u
            circumferential_gap = (
                abs(wrap(point.theta - previous.theta))
                if point.theta is not None and previous.theta is not None
                else 0.0
            )
            connected = (
                axial_gap <= config.region_epsilon_u
                and circumferential_gap <= config.region_epsilon_rad
                and _surface_compatible(point, previous)
            )
            if connected:
                current.append(point)
            else:
                flush()
                current = [point]
        previous = point
    flush()

    return [region for region in regions if len(region.members) >= 1]


def _surface_compatible(left: PatternPoint, right: PatternPoint) -> bool:
    left_surface = left.feature.surface
    right_surface = right.feature.surface
    if left_surface is None or right_surface is None:
        return True
    return left_surface == right_surface

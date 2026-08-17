/**
 * Which matcher pairs the metal loss once the girth welds are locked.
 *
 * A second axis from `algorithm`, which chooses the weld-locking phase. Keep in
 * step with `ANOMALY_MATCHERS` in `backend/src/modules/alignment/anomalyMatchers.js`;
 * that registry is what maps an id to an engine script.
 */
export const ANOMALY_MATCHERS = [
  {
    id: 'hungarian',
    label: 'Tolerance gates',
    hint: 'Pairs must fall inside the windows below. The right choice when the two runs agree on chainage.',
  },
  {
    id: 'bayesian_drift',
    label: 'Bayesian drift matching',
    hint: 'No distance window: finds the displacement the section actually has, then pairs on weight of evidence. Use when the welds locked but the metal loss did not.',
  },
] as const;

export type AnomalyMatcher = (typeof ANOMALY_MATCHERS)[number]['id'];

/**
 * Where the distance-to-upstream-girth-weld reading comes from.
 *
 * `derived` computes it from the odometer and the run's own girth welds, which
 * is the only option available when the pipetally never carried the column.
 * Derivation always applies to both runs at once — see the provenance rule in
 * `hungarian_engine._resolve_us_gw_distance_policy`.
 */
export const US_GW_DISTANCE_SOURCES = [
  { id: 'uploaded', label: 'Uploaded column', hint: 'Use the vendor’s reported distance only.' },
  { id: 'auto', label: 'Auto', hint: 'Use the vendor column when both runs report it, otherwise derive from log distance.' },
  { id: 'derived', label: 'Derive from log distance', hint: 'Always compute from the odometer and the run’s own girth welds.' },
  { id: 'off', label: 'Do not use', hint: 'Ignore weld-relative distance entirely.' },
] as const;

export type UsGwDistanceSource = (typeof US_GW_DISTANCE_SOURCES)[number]['id'];

/**
 * Where a feature's wall thickness comes from.
 *
 * Many pipetallies report thickness on the girth weld rows and leave it blank
 * on the metal loss inside the joint. A joint is one piece of pipe rolled to one
 * thickness, so `gw` reads the blank off the welds that bound it — the same
 * measurement, not an estimate. Keep in step with `WALL_THICKNESS_SOURCES` in
 * `backend/src/python_engines/hungarian_engine.py`.
 */
export const WALL_THICKNESS_SOURCES = [
  {
    id: 'uploaded',
    label: 'Uploaded column',
    hint: 'Use the thickness exactly as the tool reported it. A blank stays blank.',
  },
  {
    id: 'gw',
    label: 'Fill blanks from the girth weld',
    hint: 'Where an anomaly reports no thickness, take it from the girth welds bounding its joint.',
  },
] as const;

export type WallThicknessSource = (typeof WALL_THICKNESS_SOURCES)[number]['id'];

/**
 * Whether clustered metal loss takes part in alignment.
 *
 * A cluster is a vendor-merged group of pits, and most vendors redraw those
 * groups on every run — so pairing one across runs compares two different
 * populations and the growth rate is an artefact of the grouping. That is why
 * `bypass` is the default. Some vendors instead report a cluster as a standing
 * feature with the same grouping rules applied to both runs; `align` is for
 * those, and it is a judgement about the uploaded reports, not a preference.
 *
 * Keep in step with `resolve_cluster_alignment` in
 * `backend/src/python_engines/hungarian_engine.py`.
 */
export const CLUSTER_ALIGNMENT_MODES = [
  {
    id: 'bypass',
    label: 'Keep clusters out of alignment',
    hint: 'Clusters stay in the report as bypassed rows and still feed ERF / FFS, but are never paired OLD↔NEW.',
  },
  {
    id: 'align',
    label: 'Align clusters like anomalies',
    hint: 'Clusters are offered to the matcher on the same terms as any other metal loss, and carry a measured growth rate when they pair.',
  },
] as const;

export type ClusterAlignment = (typeof CLUSTER_ALIGNMENT_MODES)[number]['id'];

export type ToleranceValues = {
  clock_tolerance: number;
  us_gw_distance_tolerance: number;
  ds_gw_distance_tolerance: number;
  /**
   * Legacy gate. Kept on the wire because saved sessions carry it and the
   * engine still reads it as the fallback for `us_gw_distance_source`, but the
   * source selector is what the wizard now edits.
   */
  use_us_gw_distance: boolean;
  us_gw_distance_source: UsGwDistanceSource;
  /**
   * Not a matching gate — nothing in the cost matrix reads thickness. It is
   * here because it travels to the engine on the same `ToleranceConfig`, and
   * because the growth rates and the FFS intake are built from it.
   */
  wall_thickness_source: WallThicknessSource;
  /**
   * Not a gate either — it decides whether clustered metal loss is offered to
   * the matcher at all. Every strategy reads it, so one saved decision governs
   * the gated matcher, the drift matcher, AURORA and the phylogenetic chain.
   */
  cluster_alignment: ClusterAlignment;
  anomaly_matcher: AnomalyMatcher;
  /**
   * Permitted difference between the two runs' reported distance to their own
   * upstream girth weld.
   *
   * A weld-relative quantity, and a separate physical claim from the odometer
   * window above — which is what it used to share. One slider governing both
   * meant widening the odometer search to accept a drifted run also loosened
   * the strongest identity evidence in the record.
   */
  gw_offset_tolerance: number;
  length_tolerance: number;
};

export const RECOMMENDED_TOLERANCES: ToleranceValues = {
  clock_tolerance: 15,
  us_gw_distance_tolerance: 0.2,
  ds_gw_distance_tolerance: 0.2,
  use_us_gw_distance: true,
  us_gw_distance_source: 'auto',
  wall_thickness_source: 'uploaded',
  cluster_alignment: 'bypass',
  anomaly_matcher: 'hungarian',
  gw_offset_tolerance: 0.2,
  length_tolerance: 50,
};

function finiteOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function toleranceValues(source: any, legacyDistance: unknown): ToleranceValues {
  const distance = finiteOr(legacyDistance, RECOMMENDED_TOLERANCES.us_gw_distance_tolerance);
  // A session saved before the source selector existed carries only the old
  // checkbox, and an unchecked box meant "ignore weld-relative distance".
  // Reading it as `auto` would silently switch that session's gates back on —
  // so a saved config keeps the checkbox's meaning, and only a session with no
  // saved tolerances at all gets the recommended default.
  const legacySource = source == null
    ? RECOMMENDED_TOLERANCES.us_gw_distance_source
    : (source.use_us_gw_distance === false ? 'off' : 'uploaded');
  return {
    clock_tolerance: finiteOr(source?.clock_tolerance, RECOMMENDED_TOLERANCES.clock_tolerance),
    us_gw_distance_tolerance: finiteOr(source?.us_gw_distance_tolerance, distance),
    ds_gw_distance_tolerance: finiteOr(source?.ds_gw_distance_tolerance, distance),
    use_us_gw_distance: source?.use_us_gw_distance !== false,
    us_gw_distance_source: oneOf(
      source?.us_gw_distance_source,
      US_GW_DISTANCE_SOURCES.map((item) => item.id),
      legacySource,
    ),
    // A session saved before this setting existed reported exactly what the
    // tool uploaded, so that is what it keeps meaning when it is reopened.
    wall_thickness_source: oneOf(
      source?.wall_thickness_source,
      WALL_THICKNESS_SOURCES.map((item) => item.id),
      'uploaded',
    ),
    // Sessions saved before this setting existed held clusters out of
    // alignment, so reopening one must not quietly start pairing them.
    cluster_alignment: oneOf(
      source?.cluster_alignment,
      CLUSTER_ALIGNMENT_MODES.map((item) => item.id),
      'bypass',
    ),
    anomaly_matcher: oneOf(
      source?.anomaly_matcher,
      ANOMALY_MATCHERS.map((item) => item.id),
      'hungarian',
    ),
    // Sessions saved before this gate was separated carry no value; the engine
    // falls back to the odometer window for exactly the same reason.
    gw_offset_tolerance: finiteOr(
      source?.gw_offset_tolerance,
      finiteOr(source?.us_gw_distance_tolerance, distance),
    ),
    length_tolerance: finiteOr(source?.length_tolerance, RECOMMENDED_TOLERANCES.length_tolerance),
  };
}

export function defaultMatchingRules(config: any): {
  shared: ToleranceValues;
} {
  return {
    shared: toleranceValues(
      config?.ToleranceConfig,
      config?.distThresh ?? config?.scenario?.distThresh,
    ),
  };
}

/**
 * Keeps the legacy boolean in step with the source selector before the values
 * go on the wire. The engine falls back to the boolean for sessions that
 * predate the selector, so leaving the two disagreeing would make an old reader
 * and a new one draw opposite conclusions from the same saved config.
 */
export function normalizeToleranceValues(values: ToleranceValues): ToleranceValues {
  return { ...values, use_us_gw_distance: values.us_gw_distance_source !== 'off' };
}

export function buildMatchingRulesConfig({
  shared,
  byPair,
  pairs,
  primaryPairKey,
  perPairEnabled,
}: {
  shared: ToleranceValues;
  byPair: Record<string, ToleranceValues>;
  pairs: Array<{ key: string }>;
  primaryPairKey?: string;
  perPairEnabled: boolean;
}): {
  scenario?: undefined;
  distThresh?: undefined;
  ToleranceConfig: ToleranceValues;
  pairToleranceConfigs?: Record<string, ToleranceValues>;
} {
  const primary = perPairEnabled && primaryPairKey
    ? byPair[primaryPairKey] ?? shared
    : shared;
  return {
    // Legacy controls the engine never read. Cleared so a resumed session does
    // not carry them; `hiddenFeatures` is deliberately absent — the Feature
    // rules step owns that key and spreading `undefined` here would erase it.
    scenario: undefined,
    distThresh: undefined,
    ToleranceConfig: normalizeToleranceValues(primary),
    pairToleranceConfigs: perPairEnabled && pairs.length > 0
      ? Object.fromEntries(pairs.map((pair) => [
        pair.key,
        normalizeToleranceValues(byPair[pair.key] ?? shared),
      ]))
      : undefined,
  };
}

export const TOGGLEABLE_FEATURE_TYPES = [
  { key: 'valve', label: 'Valves' },
  { key: 'tee', label: 'Tees' },
  { key: 'bend', label: 'Bends' },
  { key: 'offtake', label: 'Offtakes' },
  { key: 'other', label: 'Other features' },
] as const;

export function buildFeatureRulesConfig(hiddenFeatures: string[]): { hiddenFeatures?: string[] } {
  return { hiddenFeatures: hiddenFeatures.length > 0 ? hiddenFeatures : undefined };
}

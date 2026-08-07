export type ToleranceValues = {
  clock_tolerance: number;
  us_gw_distance_tolerance: number;
  ds_gw_distance_tolerance: number;
  use_us_gw_distance: boolean;
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
  gw_offset_tolerance: 0.2,
  length_tolerance: 50,
};

function finiteOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toleranceValues(source: any, legacyDistance: unknown): ToleranceValues {
  const distance = finiteOr(legacyDistance, RECOMMENDED_TOLERANCES.us_gw_distance_tolerance);
  return {
    clock_tolerance: finiteOr(source?.clock_tolerance, RECOMMENDED_TOLERANCES.clock_tolerance),
    us_gw_distance_tolerance: finiteOr(source?.us_gw_distance_tolerance, distance),
    ds_gw_distance_tolerance: finiteOr(source?.ds_gw_distance_tolerance, distance),
    use_us_gw_distance: source?.use_us_gw_distance !== false,
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
    ToleranceConfig: primary,
    pairToleranceConfigs: perPairEnabled && pairs.length > 0
      ? Object.fromEntries(pairs.map((pair) => [pair.key, byPair[pair.key] ?? shared]))
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

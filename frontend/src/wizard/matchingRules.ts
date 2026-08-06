export type ToleranceValues = {
  clock_tolerance: number;
  us_gw_distance_tolerance: number;
  ds_gw_distance_tolerance: number;
  use_us_gw_distance: boolean;
  length_tolerance: number;
};

export const RECOMMENDED_TOLERANCES: ToleranceValues = {
  clock_tolerance: 15,
  us_gw_distance_tolerance: 0.2,
  ds_gw_distance_tolerance: 0.2,
  use_us_gw_distance: true,
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
  hiddenFeatures,
}: {
  shared: ToleranceValues;
  byPair: Record<string, ToleranceValues>;
  pairs: Array<{ key: string }>;
  primaryPairKey?: string;
  perPairEnabled: boolean;
  hiddenFeatures?: string[];
}): {
  hiddenFeatures?: string[];
  scenario?: undefined;
  distThresh?: undefined;
  ToleranceConfig: ToleranceValues;
  pairToleranceConfigs?: Record<string, ToleranceValues>;
} {
  const primary = perPairEnabled && primaryPairKey
    ? byPair[primaryPairKey] ?? shared
    : shared;
  return {
    hiddenFeatures: hiddenFeatures && hiddenFeatures.length > 0 ? hiddenFeatures : undefined,
    scenario: undefined,
    distThresh: undefined,
    ToleranceConfig: primary,
    pairToleranceConfigs: perPairEnabled && pairs.length > 0
      ? Object.fromEntries(pairs.map((pair) => [pair.key, byPair[pair.key] ?? shared]))
      : undefined,
  };
}

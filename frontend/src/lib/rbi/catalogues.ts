/**
 * The option lists, for a pipeline and nothing else.
 *
 * The threat list is ASME B31.8S's, which is the taxonomy the pipeline codes
 * use — not a refinery damage-mechanism catalogue with the vessel entries
 * deleted. Two of the eight are measured directly by an in-line metal-loss run
 * and are scored from the filed B31G assessment rather than judged.
 */

import type {
  BusinessImpactClass,
  EnvironmentClass,
  PipelineFluid,
  PopulationClass,
  RbiInspectionPlan,
  ThreatCoverage,
  ThreatId,
  ThreatRelevance,
} from './types.ts';

export interface Option<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

export type ThreatGroup = 'time-dependent' | 'stable' | 'time-independent';

export interface ThreatDefinition {
  id: ThreatId;
  label: string;
  group: ThreatGroup;
  /** True where an in-line metal-loss run measures it directly. */
  measured: boolean;
  /** What finds it, shown beside the coverage question. */
  detectedBy: string;
  hint: string;
}

export const THREAT_GROUPS: readonly { id: ThreatGroup; label: string; blurb: string }[] = [
  {
    id: 'time-dependent',
    label: 'Time dependent',
    blurb: 'Grows in service. An interval only means something against these.',
  },
  {
    id: 'stable',
    label: 'Stable',
    blurb: 'In the pipe since it was built or laid. Does not grow, but can be woken by a pressure change.',
  },
  {
    id: 'time-independent',
    label: 'Time independent',
    blurb: 'Arrives from outside. Inspection finds the damage after the fact, so mitigation matters more.',
  },
];

export const THREATS: readonly ThreatDefinition[] = [
  {
    id: 'external-corrosion',
    label: 'External corrosion',
    group: 'time-dependent',
    measured: true,
    detectedBy: 'In-line inspection, close-interval and coating surveys',
    hint: 'Measured by the metal-loss run this assessment reads. Coating condition and cathodic protection set the rate.',
  },
  {
    id: 'internal-corrosion',
    label: 'Internal corrosion',
    group: 'time-dependent',
    measured: true,
    detectedBy: 'In-line inspection, coupons, water chemistry',
    hint: 'Measured by the metal-loss run. Water, CO2, H2S and low spots decide where it concentrates.',
  },
  {
    id: 'scc',
    label: 'Stress corrosion cracking',
    group: 'time-dependent',
    measured: false,
    detectedBy: 'Crack-detection in-line inspection, hydrotest, excavation',
    hint: 'A metal-loss run cannot see it. Near-neutral pH colonies on buried line pipe, or sulphide cracking in wet sour service.',
  },
  {
    id: 'manufacturing',
    label: 'Manufacturing defect',
    group: 'stable',
    measured: false,
    detectedBy: 'Crack-detection inspection, hydrotest, mill record review',
    hint: 'Seam and pipe body flaws. Vintage low-frequency ERW and lap-welded pipe carry their own history.',
  },
  {
    id: 'construction',
    label: 'Construction defect',
    group: 'stable',
    measured: false,
    detectedBy: 'Radiography, geometry inspection, construction records',
    hint: 'Girth weld flaws, wrinkle bends, buckles, coating applied badly in the ditch.',
  },
  {
    id: 'third-party',
    label: 'Third-party and mechanical damage',
    group: 'time-independent',
    measured: false,
    detectedBy: 'Geometry inspection, right-of-way patrol, depth-of-cover survey',
    hint: 'Excavator strikes, dents and gouges. The leading cause of pipeline loss of containment in most jurisdictions.',
  },
  {
    id: 'weather-outside-force',
    label: 'Weather and outside force',
    group: 'time-independent',
    measured: false,
    detectedBy: 'Inertial mapping inspection, strain gauges, slope and washout monitoring',
    hint: 'Landslide, subsidence, scour, flooding, seismic movement. Bending strain, not wall loss.',
  },
  {
    id: 'incorrect-operations',
    label: 'Incorrect operations',
    group: 'time-independent',
    measured: false,
    detectedBy: 'Procedure and overpressure review, operator competence',
    hint: 'Overpressure, valve error, relief that did not lift. Inspection does not manage this one — procedures do.',
  },
];

export function threatById(id: ThreatId): ThreatDefinition | null {
  return THREATS.find((threat) => threat.id === id) ?? null;
}

export function threatLabel(id: ThreatId): string {
  return threatById(id)?.label ?? id;
}

export const RELEVANCE_OPTIONS: readonly Option<ThreatRelevance>[] = [
  { value: 'unreviewed', label: 'Not reviewed yet', hint: 'Scored as an unknown. The assessment cannot be issued while any threat sits here.' },
  { value: 'not-credible', label: 'Not credible here', hint: 'Contributes nothing. Say why in the note so it can be re-tested later.' },
  { value: 'possible', label: 'Credible, not seen', hint: 'The conditions exist, nothing has been found.' },
  { value: 'active', label: 'Active — found on this line', hint: 'Evidence of it exists.' },
];

export const COVERAGE_OPTIONS: readonly Option<ThreatCoverage>[] = [
  { value: 'covered', label: 'Inspected with a method that finds it', hint: 'Earns a category back.' },
  { value: 'partial', label: 'Partly inspected' },
  { value: 'none', label: 'Not inspected for', hint: 'Raises a category. An active threat nobody has looked for is an unknown, not a clear.' },
];

export const FLUID_OPTIONS: readonly Option<PipelineFluid>[] = [
  { value: 'sour-gas', label: 'Sour gas', hint: 'Toxic and flammable — mark the toxic box below.' },
  { value: 'sweet-gas', label: 'Sweet gas' },
  { value: 'lpg', label: 'LPG or NGL', hint: 'Flashes on release.' },
  { value: 'crude-oil', label: 'Crude oil' },
  { value: 'condensate', label: 'Condensate' },
  { value: 'refined-product', label: 'Refined product' },
  { value: 'produced-water', label: 'Produced water' },
  { value: 'water', label: 'Water' },
];

export const POPULATION_OPTIONS: readonly Option<PopulationClass>[] = [
  { value: 'remote', label: 'Remote — no dwellings' },
  { value: 'rural', label: 'Rural' },
  { value: 'suburban', label: 'Suburban' },
  { value: 'urban', label: 'Urban or high occupancy' },
];

export const ENVIRONMENT_OPTIONS: readonly Option<EnvironmentClass>[] = [
  { value: 'none', label: 'No sensitive receptor' },
  { value: 'soil', label: 'Soil only' },
  { value: 'groundwater', label: 'Groundwater or aquifer' },
  { value: 'surface-water', label: 'Surface water or watercourse' },
  { value: 'protected', label: 'Protected or designated area' },
];

export const BUSINESS_OPTIONS: readonly Option<BusinessImpactClass>[] = [
  { value: 'low', label: 'Low — alternative route available' },
  { value: 'moderate', label: 'Moderate — reduced throughput' },
  { value: 'high', label: 'High — production stops' },
  { value: 'critical', label: 'Critical — no redundancy, long lead time' },
];

/** Named once, so the screen and the workbook cannot describe an interval differently. */
export const INTERVAL_BASIS_LABEL: Record<RbiInspectionPlan['basis'], string> = {
  'half-remaining-life': 'Half the remaining life',
  'risk-target-interval': 'Risk-based target',
  'regulatory-limit': 'Regulatory limit',
  'immediate-action': 'Immediate action',
};

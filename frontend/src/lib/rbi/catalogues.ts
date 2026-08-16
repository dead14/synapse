/**
 * The lists API 580 itself enumerates, turned into options.
 *
 * Everything here is transcribed from the practice rather than invented: the
 * objectives from §6.2, the team roles from §7.2, the data sources from §8.5,
 * the non-mechanism causes of loss of containment from §10.1, the reassessment
 * triggers from §15.2–§15.3, and the equipment classes from §6.3.5 and §16.4.
 * Keeping them as catalogues rather than free text is what makes two assessments
 * of two lines comparable, which is the whole point of a *relative* risk ranking
 * (§4.3).
 *
 * The damage mechanism catalogue is the one exception and is labelled as such:
 * API 580 §9 does not list mechanisms, it requires a corrosion specialist to
 * identify them (§9.1) and points at API 571 for the mechanisms themselves. What
 * follows is a starting list for a transmission pipeline, offered to the
 * specialist to accept, amend, or rule out — never a claim that these are the
 * mechanisms present.
 */

import type {
  RbiDetectionRating,
  RbiEnvironmentReceptor,
  RbiFailureMode,
  RbiFluidClass,
  RbiInspectionEffectiveness,
  RbiIsolationRating,
  RbiPopulationClass,
  RbiRateBasis,
  RbiSusceptibility,
} from './types.ts';

export interface Option<T extends string = string> {
  value: T;
  label: string;
  hint?: string;
}

/** §6.2 — the objectives an RBI assessment may be established to meet. */
export const RBI_OBJECTIVES: readonly Option[] = [
  { value: 'understand-risks', label: 'Understand risks', hint: '§6.2.2 — establish where the risk actually sits.' },
  { value: 'define-risk-criteria', label: 'Define risk criteria', hint: '§6.2.3 — set the thresholds, where the company has none.' },
  { value: 'manage-risks', label: 'Manage risks', hint: '§6.2.4 — reduce identified risk to an acceptable level.' },
  { value: 'optimize-costs', label: 'Optimise inspection costs', hint: '§6.2.5 — a side benefit, rarely the primary objective.' },
  { value: 'meet-requirements', label: 'Meet safety and environmental requirements', hint: '§6.2.6.' },
  { value: 'evaluate-mitigation', label: 'Identify and evaluate mitigation options', hint: '§6.2.7 — actions other than inspection.' },
  { value: 'end-of-life', label: 'End-of-life strategy', hint: '§6.2.9 — maximum remaining benefit without undue risk.' },
  { value: 'turnaround-planning', label: 'Turnaround / shutdown planning', hint: '§15.3.4 — focus the work on the higher-risk items.' },
];

/** §7.2 — the roles the practice names, and what each is there to bring. */
export const TEAM_ROLES: readonly Option[] = [
  { value: 'team-leader', label: 'Team leader', hint: '§7.2.2 — owns the assessment and its consistency.' },
  { value: 'inspector', label: 'Equipment inspector / inspection specialist', hint: '§7.2.3 — inspection history and effectiveness.' },
  { value: 'corrosion-specialist', label: 'Corrosion specialist', hint: '§7.2.4 / §9.1 — required to define the damage mechanisms.' },
  { value: 'process-specialist', label: 'Process specialist', hint: '§7.2.5 — process conditions, trace species, excursions.' },
  { value: 'operations', label: 'Operations / maintenance', hint: '§7.2.6 — what the plant actually does, as opposed to the drawing.' },
  { value: 'management', label: 'Management', hint: '§7.2.7 — accepts the risk and funds the plan.' },
  { value: 'risk-analyst', label: 'Risk analyst', hint: '§7.2.8 — the methodology and its correct application.' },
  { value: 'hse', label: 'Environmental and safety', hint: '§7.2.9 — consequence to people and surroundings.' },
  { value: 'financial', label: 'Financial / business', hint: '§7.2.10 — production loss and replacement cost.' },
];

export const CORROSION_SPECIALIST_ROLE = 'corrosion-specialist';
export const TEAM_LEADER_ROLE = 'team-leader';

/** §8.5 — where the data comes from. */
export const DATA_SOURCES: readonly Option[] = [
  { value: 'design-records', label: 'Design and construction records', hint: 'P&IDs, isometrics, MSDs, equipment data sheets.' },
  { value: 'protective-systems', label: 'Protective and relief systems', hint: 'Instrumented protection, depressurising, fire-fighting.' },
  { value: 'inspection-history', label: 'Inspection history', hint: 'Coverage, methods, results, repairs, PMI.' },
  { value: 'ili-runs', label: 'In-line inspection runs', hint: 'The measured metal loss this assessment is built on.' },
  { value: 'ccd', label: 'Corrosion control document (API 970)', hint: '§9.2 — a CCD is the natural basis for the DMR.' },
  { value: 'dmr-previous', label: 'Previous damage mechanism review', hint: '§9.2.' },
  { value: 'iow', label: 'Integrity operating windows (API 584)', hint: '§9.4.' },
  { value: 'failure-analysis', label: 'Failure analysis / incident investigations', hint: '§8.5 c, l.' },
  { value: 'ffs', label: 'Fitness-for-service assessments (API 579)', hint: '§8.5 d — the B31G case this assessment reads.' },
  { value: 'process-data', label: 'Process data and mass balance', hint: 'Including trace species — §9.1 b.' },
  { value: 'operating-logs', label: 'Operating procedures and logs', hint: 'Start-up, shutdown, emergency procedures.' },
  { value: 'moc', label: 'Management of change records', hint: '§8.1 d, §15.2.3.' },
  { value: 'pha', label: 'PHA / PSM / QRA studies', hint: '§8.5 e, k.' },
  { value: 'failure-data', label: 'Generic or plant-specific failure frequency data', hint: '§8.5 h.' },
  { value: 'site-conditions', label: 'Site conditions', hint: 'Climate, weather, seismic records — §8.5 i.' },
  { value: 'costs', label: 'Replacement and project cost data', hint: '§8.5 j — the economic consequence.' },
  { value: 'offsite', label: 'Off-site data', hint: '§8.5 g — where the consequence reaches beyond the fence.' },
];

/** §6.3.5 / §16.4 — the classes an owner-user declares in or out of scope. */
export const EQUIPMENT_CLASSES: readonly Option[] = [
  { value: 'transmission-pipeline', label: 'Transmission pipeline' },
  { value: 'flowline', label: 'Flowline / gathering line' },
  { value: 'process-piping', label: 'Process piping and components' },
  { value: 'pressure-vessels', label: 'Pressure vessels' },
  { value: 'storage-tanks', label: 'Storage tanks' },
  { value: 'heat-exchangers', label: 'Heat exchangers' },
  { value: 'boilers-heaters', label: 'Boilers, furnaces and heaters' },
  { value: 'relief-devices', label: 'Pressure-relief devices' },
  { value: 'rotating', label: 'Rotating equipment (pressure-containing parts)' },
  { value: 'instrument-control', label: 'Instrument and control systems' },
  { value: 'electrical', label: 'Electrical systems' },
  { value: 'structural', label: 'Structural systems' },
  { value: 'utilities', label: 'Utility and off-plot systems' },
];

/** §2 and §16.11 — the codes an assessment of a pipeline is usually held to. */
export const CODES_AND_STANDARDS: readonly Option[] = [
  { value: 'api-580', label: 'API RP 580 — Risk-based inspection' },
  { value: 'api-581', label: 'API RP 581 — RBI methodology (quantitative)' },
  { value: 'api-570', label: 'API 570 — Piping inspection code' },
  { value: 'api-510', label: 'API 510 — Pressure vessel inspection code' },
  { value: 'api-571', label: 'API RP 571 — Damage mechanisms' },
  { value: 'api-579', label: 'API 579-1 / ASME FFS-1 — Fitness-for-service' },
  { value: 'api-584', label: 'API RP 584 — Integrity operating windows' },
  { value: 'api-585', label: 'API RP 585 — Incident investigation' },
  { value: 'api-970', label: 'API RP 970 — Corrosion control documents' },
  { value: 'asme-b31g', label: 'ASME B31G — Remaining strength of corroded pipelines' },
  { value: 'asme-b31-4', label: 'ASME B31.4 — Liquid pipelines' },
  { value: 'asme-b31-8', label: 'ASME B31.8 — Gas transmission and distribution' },
  { value: 'asme-b31-8s', label: 'ASME B31.8S — Managing pipeline system integrity' },
  { value: 'local-regulation', label: 'Local jurisdictional regulation' },
];

/**
 * §10.1 — causes of loss of containment that are not damage mechanisms.
 *
 * They are recorded as considered, not scored. The practice says they "may be
 * (but are not commonly) included in the POF analysis", so this list exists to
 * stop the assessment implying it covered them.
 */
export const OTHER_LOSS_CAUSES: readonly Option[] = [
  { value: 'seismic', label: 'Seismic activity' },
  { value: 'weather', label: 'Weather extremes' },
  { value: 'overpressure', label: 'Overpressure — relief device not lifting' },
  { value: 'operator-error', label: 'Operator error' },
  { value: 'material-substitution', label: 'Inadvertent substitution of materials' },
  { value: 'design-error', label: 'Design error' },
  { value: 'sabotage', label: 'Sabotage or third-party interference' },
];

/** §15.2–§15.3 — what sends the assessment back for reassessment. */
export const REASSESSMENT_TRIGGERS: readonly Option[] = [
  { value: 'inspection-results', label: 'New inspection results', hint: '§15.2.2 — results shall be reviewed for their effect on risk.' },
  { value: 'process-change', label: 'Process condition change', hint: '§15.2.3 — the change most often linked to unexpected failure.' },
  { value: 'hardware-change', label: 'Hardware modification or replacement', hint: '§15.2.3.' },
  { value: 'moc', label: 'Management of change raised', hint: '§15.4 c.' },
  { value: 'iow-exceedance', label: 'IOW exceedance', hint: '§16.1 i — an exceedance is a trigger, not a log entry.' },
  { value: 'premise-change', label: 'Assessment premise change', hint: '§15.2.4 — population, costs, regulations, risk criteria.' },
  { value: 'mitigation-implemented', label: 'Risk mitigation implemented', hint: '§15.3.3 — confirm the mitigation actually worked.' },
  { value: 'failure', label: 'Loss of containment or failure investigation', hint: '§13.7.' },
  { value: 'turnaround', label: 'Before and after a turnaround', hint: '§15.3.4.' },
  { value: 'time-elapsed', label: 'Maximum time period elapsed', hint: '§15.1.3 — API 510/570 cap reassessment at 10 years.' },
];

/**
 * A starting list of damage mechanisms for a transmission pipeline.
 *
 * NOT a substitute for the review §9.1 requires: "The RBI team shall consult
 * with a corrosion specialist to define the damage mechanisms and damage modes…
 * for each component in the RBI assessment." The specialist's job is to strike
 * out what is not credible here (§9.5 b) and add what is missing. `damageMode`
 * and `failureMode` are the usual pairing for each, pre-filled so a row starts
 * consistent, and every one of them is editable.
 */
export interface DamageMechanismDefinition {
  id: string;
  label: string;
  /** Thinning, pitting, cracking, mechanical, metallurgical. §9.1. */
  damageMode: string;
  failureMode: RbiFailureMode;
  /** How this mechanism's progress is normally expressed. §9.2. */
  rateBasis: RbiRateBasis;
  /** The examination that actually finds it. §13.2.2 c. */
  technique: string;
  group: 'internal' | 'external' | 'cracking' | 'mechanical' | 'metallurgical';
  hint: string;
}

export const DAMAGE_MECHANISMS: readonly DamageMechanismDefinition[] = [
  {
    id: 'internal-general-corrosion',
    label: 'Internal general corrosion',
    damageMode: 'General thinning',
    failureMode: 'leak',
    rateBasis: 'measured-ili',
    technique: 'In-line inspection (MFL/UT), UT thickness monitoring',
    group: 'internal',
    hint: 'Uniform wall loss. The mechanism an ILI metal-loss run measures directly.',
  },
  {
    id: 'internal-pitting',
    label: 'Internal pitting / localised corrosion',
    damageMode: 'Pitting',
    failureMode: 'pinhole-leak',
    rateBasis: 'measured-ili',
    technique: 'High-resolution ILI, UT scanning, radiography',
    group: 'internal',
    hint: 'Spot thickness readings are near worthless here — §13.4 says so explicitly.',
  },
  {
    id: 'co2-corrosion',
    label: 'CO₂ (sweet) corrosion',
    damageMode: 'Localised thinning, mesa attack',
    failureMode: 'leak',
    rateBasis: 'corrosion-rate',
    technique: 'ILI, corrosion coupons, ER probes, water chemistry',
    group: 'internal',
    hint: 'Driven by CO₂ partial pressure, temperature and water wetting.',
  },
  {
    id: 'h2s-corrosion',
    label: 'H₂S (sour) corrosion',
    damageMode: 'General and localised thinning',
    failureMode: 'leak',
    rateBasis: 'corrosion-rate',
    technique: 'ILI, coupons, sulphide scale analysis',
    group: 'internal',
    hint: 'Record the H₂S ppm on the process step — §9.1 b calls trace species out by name.',
  },
  {
    id: 'mic',
    label: 'Microbiologically influenced corrosion',
    damageMode: 'Deep localised pitting',
    failureMode: 'pinhole-leak',
    rateBasis: 'susceptibility',
    technique: 'ILI with pit sizing, bacterial culture, deposit analysis',
    group: 'internal',
    hint: 'Concentrates at low points and under deposits; rates are erratic.',
  },
  {
    id: 'under-deposit',
    label: 'Under-deposit / solids corrosion',
    damageMode: 'Localised thinning at 6 o’clock',
    failureMode: 'leak',
    rateBasis: 'susceptibility',
    technique: 'ILI, pigging returns, bottom-quadrant UT',
    group: 'internal',
    hint: 'Bottom-quadrant clustering in the ILI is the usual first evidence.',
  },
  {
    id: 'erosion-corrosion',
    label: 'Erosion / erosion-corrosion',
    damageMode: 'Directional thinning',
    failureMode: 'leak',
    rateBasis: 'corrosion-rate',
    technique: 'UT scanning at bends and tees, velocity review',
    group: 'internal',
    hint: 'Bends, tees, and downstream of chokes. Velocity is the driver.',
  },
  {
    id: 'external-corrosion',
    label: 'External corrosion',
    damageMode: 'General and localised thinning',
    failureMode: 'leak',
    rateBasis: 'measured-ili',
    technique: 'ILI, CIPS/DCVG, coating survey, CP potential survey',
    group: 'external',
    hint: 'Coating condition and CP performance decide the rate.',
  },
  {
    id: 'cui',
    label: 'Corrosion under insulation',
    damageMode: 'Localised external thinning',
    failureMode: 'leak',
    rateBasis: 'susceptibility',
    technique: 'Insulation removal, profile radiography, pulsed eddy current',
    group: 'external',
    hint: '§6.2.7 e names removing unnecessary insulation as a mitigation in itself.',
  },
  {
    id: 'cp-disbondment',
    label: 'Coating disbondment / CP shielding',
    damageMode: 'Shielded external corrosion',
    failureMode: 'leak',
    rateBasis: 'susceptibility',
    technique: 'DCVG, close-interval survey, excavation',
    group: 'external',
    hint: 'Tape-wrap and shrink-sleeve coatings shield the current they are meant to pass.',
  },
  {
    id: 'ac-dc-interference',
    label: 'AC / DC stray current interference',
    damageMode: 'Localised external attack',
    failureMode: 'pinhole-leak',
    rateBasis: 'susceptibility',
    technique: 'AC current density survey, coupon monitoring',
    group: 'external',
    hint: 'Corridors shared with HV lines or traction systems.',
  },
  {
    id: 'sscc',
    label: 'Sulphide stress cracking (SSC)',
    damageMode: 'Cracking',
    failureMode: 'rupture',
    rateBasis: 'susceptibility',
    technique: 'Crack-detection ILI, shear-wave UT, hardness survey',
    group: 'cracking',
    hint: 'Wet H₂S plus hardness. §9.2 treats cracking as susceptibility, not rate.',
  },
  {
    id: 'hic-sohic',
    label: 'HIC / SOHIC',
    damageMode: 'Blistering and stepwise cracking',
    failureMode: 'rupture',
    rateBasis: 'susceptibility',
    technique: 'Ultrasonic mapping, TOFD, WFMT',
    group: 'cracking',
    hint: 'Wet H₂S in susceptible plate; not detected by a metal-loss run.',
  },
  {
    id: 'escc-chloride',
    label: 'Chloride stress corrosion cracking',
    damageMode: 'Cracking',
    failureMode: 'leak',
    rateBasis: 'susceptibility',
    technique: 'PT, ECT, shear-wave UT',
    group: 'cracking',
    hint: 'Austenitic stainless in chlorides above roughly 60 °C.',
  },
  {
    id: 'scc-external',
    label: 'External SCC (near-neutral / high-pH)',
    damageMode: 'Colony cracking',
    failureMode: 'rupture',
    rateBasis: 'susceptibility',
    technique: 'Crack-detection ILI (EMAT/UT), hydrotest, excavation',
    group: 'cracking',
    hint: 'A classic transmission-line mechanism a metal-loss run cannot see.',
  },
  {
    id: 'fatigue-mechanical',
    label: 'Mechanical fatigue',
    damageMode: 'Cracking',
    failureMode: 'leak',
    rateBasis: 'susceptibility',
    technique: 'Crack-detection ILI, MPI at welds, strain monitoring',
    group: 'cracking',
    hint: '§13.3 warns high-cycle fatigue can outrun any periodic inspection plan.',
  },
  {
    id: 'fatigue-thermal',
    label: 'Thermal fatigue',
    damageMode: 'Cracking',
    failureMode: 'leak',
    rateBasis: 'susceptibility',
    technique: 'PT/MPI at restraints, thermal cycling review',
    group: 'cracking',
    hint: 'Cyclic service — §6.4.3 asks for the whole cycle to be considered.',
  },
  {
    id: 'dent-gouge',
    label: 'Dents, gouges and mechanical damage',
    damageMode: 'Geometry and cracking',
    failureMode: 'rupture',
    rateBasis: 'susceptibility',
    technique: 'Geometry ILI (caliper), in-ditch assessment, API 579 Part 12',
    group: 'mechanical',
    hint: 'A metal-loss assessment does not represent these; state it as a limitation.',
  },
  {
    id: 'third-party',
    label: 'Third-party interference',
    damageMode: 'Impact damage',
    failureMode: 'rupture',
    rateBasis: 'susceptibility',
    technique: 'Right-of-way patrol, depth-of-cover survey, one-call compliance',
    group: 'mechanical',
    hint: '§10.1 g — a cause of loss of containment outside the damage mechanisms.',
  },
  {
    id: 'geohazard',
    label: 'Ground movement / geohazard',
    damageMode: 'Bending strain',
    failureMode: 'rupture',
    rateBasis: 'susceptibility',
    technique: 'IMU/geometry ILI, strain gauges, slope monitoring',
    group: 'mechanical',
    hint: 'Landslide, subsidence, washout, seismic — §10.1 a.',
  },
  {
    id: 'weld-fabrication',
    label: 'Weld or fabrication defect',
    damageMode: 'Pre-existing flaw',
    failureMode: 'leak',
    rateBasis: 'susceptibility',
    technique: 'Radiography, TOFD, construction record review',
    group: 'mechanical',
    hint: 'Vintage seam types (ERW, lap weld) carry their own history.',
  },
  {
    id: 'brittle-fracture',
    label: 'Brittle fracture',
    damageMode: 'Metallurgical',
    failureMode: 'rupture',
    rateBasis: 'susceptibility',
    technique: 'MDMT review, toughness data, operating temperature review',
    group: 'metallurgical',
    hint: '§13.3 b — an instantaneous failure mode inspection cannot manage.',
  },
  {
    id: 'creep',
    label: 'Creep',
    damageMode: 'Metallurgical',
    failureMode: 'rupture',
    rateBasis: 'susceptibility',
    technique: 'Replication, dimensional survey, temperature history',
    group: 'metallurgical',
    hint: 'Only credible above the creep range for the material.',
  },
  {
    id: 'hydrogen-embrittlement',
    label: 'Hydrogen embrittlement',
    damageMode: 'Metallurgical',
    failureMode: 'rupture',
    rateBasis: 'susceptibility',
    technique: 'Hardness survey, material and CP-potential review',
    group: 'metallurgical',
    hint: 'Over-protection by CP is a known source on buried line pipe.',
  },
];

export function damageMechanismById(id: string): DamageMechanismDefinition | null {
  return DAMAGE_MECHANISMS.find((item) => item.id === id) ?? null;
}

/** Grouped for the picker, in the order a corrosion specialist reads them. */
export const MECHANISM_GROUPS: readonly { id: DamageMechanismDefinition['group']; label: string }[] = [
  { id: 'internal', label: 'Internal corrosion' },
  { id: 'external', label: 'External corrosion' },
  { id: 'cracking', label: 'Cracking' },
  { id: 'mechanical', label: 'Mechanical and third-party' },
  { id: 'metallurgical', label: 'Metallurgical' },
];

/* ── Enumerated field labels ───────────────────────────────────────────────── */

export const FLUID_OPTIONS: readonly Option<RbiFluidClass>[] = [
  { value: 'sour-gas', label: 'Sour gas (H₂S)', hint: 'Toxic and flammable — the worst pairing in §11.5.' },
  { value: 'sweet-gas', label: 'Sweet gas' },
  { value: 'lpg', label: 'LPG / NGL', hint: 'Flashes on release; BLEVE is credible.' },
  { value: 'crude-oil', label: 'Crude oil' },
  { value: 'condensate', label: 'Condensate' },
  { value: 'refined-product', label: 'Refined product' },
  { value: 'produced-water', label: 'Produced water' },
  { value: 'water', label: 'Water' },
  { value: 'steam', label: 'Steam / hot water', hint: '§11.5.4 — thermal burns, not flammability.' },
];

export const POPULATION_OPTIONS: readonly Option<RbiPopulationClass>[] = [
  { value: 'remote', label: 'Remote — no dwellings' },
  { value: 'rural', label: 'Rural' },
  { value: 'suburban', label: 'Suburban' },
  { value: 'urban', label: 'Urban / high occupancy' },
];

export const RECEPTOR_OPTIONS: readonly Option<RbiEnvironmentReceptor>[] = [
  { value: 'none', label: 'No sensitive receptor' },
  { value: 'soil', label: 'Soil only' },
  { value: 'groundwater', label: 'Groundwater / aquifer' },
  { value: 'surface-water', label: 'Surface water / watercourse' },
  { value: 'protected', label: 'Protected or designated area' },
];

export const DETECTION_OPTIONS: readonly Option<RbiDetectionRating>[] = [
  { value: 'A', label: 'A — instrumented detection, alarms in the control room' },
  { value: 'B', label: 'B — detection by inference (flow/pressure balance)' },
  { value: 'C', label: 'C — visual or reported detection only' },
];

export const ISOLATION_OPTIONS: readonly Option<RbiIsolationRating>[] = [
  { value: 'A', label: 'A — remotely operated isolation, actuates on detection' },
  { value: 'B', label: 'B — remotely operated, manual initiation' },
  { value: 'C', label: 'C — manual isolation at the valve' },
];

/**
 * §10.4.2 — the inspection-effectiveness ladder.
 *
 * The letters are the API 581 Part 2 Annex 2.C convention API 580 §10.4.2 refers
 * to. What each grade *does* to the probability category is this product's own
 * documented rule and lives in `api580.ts`, not here.
 */
export const EFFECTIVENESS_OPTIONS: readonly Option<RbiInspectionEffectiveness>[] = [
  { value: 'A', label: 'A — highly effective', hint: 'Correctly identifies the damage state in nearly every case.' },
  { value: 'B', label: 'B — usually effective' },
  { value: 'C', label: 'C — fairly effective' },
  { value: 'D', label: 'D — poorly effective', hint: 'Wrong technique, or coverage too small to conclude from.' },
  { value: 'E', label: 'E — ineffective', hint: 'Provides almost no information about the damage state.' },
  { value: 'none', label: 'No inspection performed', hint: 'Not the same as ineffective, and scored worse than it.' },
];

export const SUSCEPTIBILITY_OPTIONS: readonly Option<RbiSusceptibility>[] = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export const RATE_BASIS_OPTIONS: readonly Option<RbiRateBasis>[] = [
  { value: 'measured-ili', label: 'Measured — from the filed FFS assessment', hint: 'Scored from the B31G results, not from this row.' },
  { value: 'corrosion-rate', label: 'Corrosion rate (mm/y)', hint: '§9.2 — for thinning, where a rate can be stated.' },
  { value: 'susceptibility', label: 'Susceptibility', hint: '§9.2 — where the rate is unknown or immeasurable.' },
];

export const FAILURE_MODE_OPTIONS: readonly Option<RbiFailureMode>[] = [
  { value: 'pinhole-leak', label: 'Pinhole leak' },
  { value: 'leak', label: 'Leak' },
  { value: 'rupture', label: 'Rupture' },
];

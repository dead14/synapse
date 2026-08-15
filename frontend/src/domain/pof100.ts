/**
 * POF 100 terminology.
 *
 * Source: Pipeline Operators Forum, *Specifications and requirements for
 * in-line inspection of pipelines*, Standard Practice POF 100, November 2021 —
 * §2.2 Definitions, §2.7 Resolution of measurement parameters, Appendix 2
 * "Report structure, terminology and abbreviations" and Appendix 8 "Run
 * comparison example".
 *
 * Clients read our screens and our workbook next to the ILI contractor's own
 * report, and POF 100 is the vocabulary that report is written in. Inventing a
 * house word for a thing POF already names — "Master Axis" for a log distance,
 * "U/S weld distance" for the feature-to-upstream-weld distance — makes the two
 * documents look like they describe different pipe. So the prescribed word wins
 * wherever POF prescribes one.
 *
 * What this module is *not*: a rename of the engine's data keys. Those keys are
 * the wire format between the Python engines, the repository, the exports and
 * every consumer in this app; renaming them is a migration, not a translation.
 * This is the display boundary — engine key in, POF 100 column title out.
 *
 * Where POF has no term (the aligned coordinate the app derives, the engine's
 * own result buckets) the entry says so in a comment rather than dressing an
 * invented word up as a standard one.
 */

/** Anomaly/feature terms and their POF abbreviations (Appendix 2). */
export const POF_FEATURE_TYPES = {
  ADME: 'Additional metal/material',
  ANOM: 'Anomaly',
  COMP: 'Component',
  MARK: 'Marker',
  OTHE: 'Other',
  REPA: 'Repair',
  WELD: 'Weld',
} as const;

/** Surface location, POF Appendix 2 — the only four values POF admits. */
export const POF_SURFACE_LOCATION = {
  INT: 'Internal',
  EXT: 'External',
  MID: 'Mid wall',
  'N/A': 'Not applicable',
} as const;

/**
 * Components, POF Appendix 2 "Feature identification: Component".
 *
 * Keyed by the viewer's own `FeatureKind`, which is a drawing decision (what
 * shape to paint) rather than a POF classification, so the mapping lives here
 * instead of in the classifier.
 */
export const POF_COMPONENT_LABEL: Record<string, string> = {
  valve: 'Valve',
  // POF spells the branch component "Off take" (OFFT) and keeps "Tee" (TEE)
  // separate; one lane marker covers both, so both names are shown.
  tee: 'Tee / off take',
  // "Bend begin/-end" (BENB/BENE) is filed under Weld in POF, not Component.
  bend: 'Bend',
  flange: 'Flange',
  // Anything else the vendor listed as pipeline furniture: anode, casing,
  // sleeve, ground anchor, pipeline fixture. POF's umbrella for them.
  fitting: 'Other component',
};

/**
 * How a feature relates to the neighbouring run.
 *
 * POF 100 §7.5 asks a run comparison to report "new or missed features" and
 * Appendix 8 writes the outcome in the Comment column as "Weld matched",
 * "Corrosion matched", "New corrosion", "New weld". These are that vocabulary,
 * generalised over the feature type.
 */
export const POF_RUN_COMPARISON_STATUS: Record<string, string> = {
  persistent: 'Matched',
  new: 'New in this run',
  lost: 'Missed in next run',
  transient: 'New, then missed',
  // Not a POF outcome: the run has no neighbour to be compared against.
  single: 'No comparison run',
};

/** The same vocabulary, shortened for a badge. */
export const POF_RUN_COMPARISON_BADGE: Record<string, string> = {
  persistent: 'Matched',
  new: 'New',
  lost: 'Missed next run',
  transient: 'New, then missed',
  single: 'Single run',
};

/**
 * Engine result-column keys → the POF 100 column title for the same quantity.
 *
 * `{S}` expands to the OLD and NEW side suffixes the engine writes. POF's own
 * run-comparison layout (Appendix 8) puts the two runs in banded column groups
 * and repeats the plain title in each; a flat sortable table cannot band, so the
 * side rides along on the title.
 *
 * Units follow POF §2.7 and Appendix 2: metres, millimetres, and depth as a
 * percentage of wall thickness `t`.
 */
const SIDED_COLUMN_TITLES: Array<[string, string]> = [
  // Location on the line. POF: "Log distance", starting point the trap valve.
  ['Log Dist {S} (m)', 'Log distance {S} [m]'],
  ['Abs. Dist {S} (m)', 'Log distance {S} [m]'],
  ['Original Log Dist {S} (m)', 'Log distance {S} [m] (as reported)'],

  // POF Appendix 2 separates the two identification levels, and so does the
  // engine: "Feature type" is Anomaly / Component / Weld / Marker, while
  // "Feature identification" is Corrosion / Dent plain / Valve / Bend begin.
  ['Feature Type {S}', 'Feature type {S}'],
  ['Feature Identification {S}', 'Feature identification {S}'],
  // POF "Anomaly class": General, Pitting, Axial grooving, Pinhole … (Fig. 2.2).
  ['Dim Classification {S}', 'Anomaly class {S}'],
  // Not a POF column. It is the vendor's own record number for the feature,
  // which POF leaves to the contractor, so it keeps a plain descriptive name.
  ['Identif. {S}', 'Feature number {S}'],
  ['Feature ID {S}', 'Feature number {S}'],

  // Reference joint. POF: "Girth weld Nr", "Joint / component length [m]".
  ['Joint No. {S}', 'Girth weld number {S}'],
  ['Joint Len {S} (m)', 'Joint length {S} [m]'],
  // POF Appendix 8: "Feature to upstream weld [m]"; Appendix 2 calls the same
  // quantity "Abs up weld dist.".
  ['Dist GW {S} (m)', 'Feature to upstream weld {S} [m]'],
  ['Dist GW Source {S}', 'Feature to upstream weld {S} — source'],

  // Dimensions and position on the joint.
  ['Wall WT {S} (mm)', 'Wall thickness {S} [mm]'],
  // Not a POF column. POF assumes the thickness was reported against the
  // feature; when it was taken off the joint's girth welds instead, the reader
  // has to be able to see that before the number reaches an assessment.
  ['Wall WT Source {S}', 'Wall thickness {S} — source'],
  ["O'Clock {S}", 'Clock position {S}'],
  ['Length {S} (mm)', 'Length {S} [mm]'],
  ['Width {S} (mm)', 'Width {S} [mm]'],
  // POF reports MFL depth as a percentage of the reference wall thickness `t`.
  ['Depth {S} (%WT)', 'Depth {S} [%t]'],
  ['Surface {S}', 'Surface location {S}'],
  ['Int/Ext {S}', 'Surface location {S}'],

  // Severity. POF §2.6.3: ERF = MAOP / Psafe. The assessment method is stated
  // separately in the report, so the column is just "ERF".
  ['ERF ASME {S}', 'ERF {S}'],
  ['Psafe {S} (bar)', 'Psafe {S} [bar]'],
  ['Comment {S}', 'Comments {S}'],
  ['Run Year {S}', 'Survey year {S}'],
  ['Section {S}', 'Section {S}'],
];

const PLAIN_COLUMN_TITLES: Record<string, string> = {
  // POF has no term for this: it is the newest run's log distance used as a
  // shared axis, with the older runs projected onto it. Named after the POF
  // quantity it is derived from, and qualified so it is never mistaken for a
  // run's own reported log distance.
  'Master Axis (m)': 'Log distance, aligned [m]',

  // POF §7.5 asks the comparison to report matching and non-matching features
  // per joint; Appendix 8 carries the outcome in the Comment column.
  'Match/Unmatch': 'Run comparison',
  'Match Status': 'Run comparison',
  // App concepts with no POF equivalent — the engine's own bucketing.
  'Result Group': 'Result group',
  'Bypass Reason': 'Not aligned — reason',
  'Match Method': 'Matching method',
  'Match Confidence (%)': 'Match confidence [%]',
  'Match Cost': 'Match cost',
  'Match Log Bayes Factor': 'Match log Bayes factor',

  'Depth Growth (%WT/yr)': 'Depth growth [%t/yr]',
  'Depth Growth (mm/yr)': 'Depth growth [mm/yr]',
  'Length Growth (mm/yr)': 'Length growth [mm/yr]',
  'Growth Interval (y)': 'Interval between runs [y]',
  'Physics Warning': 'Growth check',
  'Run Pair': 'Run pair',
};

function expandSides(): Record<string, string> {
  const titles: Record<string, string> = { ...PLAIN_COLUMN_TITLES };
  for (const [key, title] of SIDED_COLUMN_TITLES) {
    for (const side of ['OLD', 'NEW'] as const) {
      titles[key.replace('{S}', side)] = title.replace('{S}', side);
    }
  }
  return titles;
}

export const POF_COLUMN_TITLES: Record<string, string> = expandSides();

/**
 * The POF 100 column title for an engine result key, or the key untouched when
 * POF names nothing like it. Unknown columns are shown as the engine wrote them
 * rather than guessed at — a made-up standard term is worse than a plain one.
 */
export function pofColumnTitle(column: string): string {
  return POF_COLUMN_TITLES[column] ?? column;
}

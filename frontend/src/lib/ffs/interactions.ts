import { evaluateB31g, type B31gKernelResult } from './b31g.ts';
import type { FfsInteractionPair, FfsScreenedResult } from './types.ts';

export const ASME_INTERACTION_SPACING_FACTOR = 3;

export interface FfsInteractionAssessment {
  id: string;
  members: FfsScreenedResult[];
  pairs: FfsInteractionPair[];
  resolved: boolean;
  combinedLengthMm: number | null;
  combinedDepthPct: number | null;
  evaluation: B31gKernelResult | null;
  status: 'pass' | 'fail' | 'unresolved';
  reason: string;
}

function numericLd(item: FfsScreenedResult): number {
  const value = Number(item.nominal.ld);
  return Number.isFinite(value) ? value : 0;
}

function circumferentialEdgeGapMm(a: FfsScreenedResult, b: FfsScreenedResult): number | null {
  if (a.clockHour === null || b.clockHour === null) return null;
  const deltaHours = Math.abs(a.clockHour - b.clockHour);
  const shortestHours = Math.min(deltaHours, 12 - deltaHours);
  const diameter = Math.max(a.nominal.od, b.nominal.od);
  const centreArcMm = (shortestHours / 12) * Math.PI * diameter;
  return centreArcMm - (a.nominal.width + b.nominal.width) / 2;
}

/**
 * Para. 1.12 interaction candidates. Both surface-plane edge gaps must be
 * within 3t. When the axial condition is met but clock data is absent, the pair
 * stays unresolved and blocks final reporting instead of being silently lost.
 */
export function findInteractionPairs(items: FfsScreenedResult[]): FfsInteractionPair[] {
  const sorted = [...items].sort((a, b) => numericLd(a) - numericLd(b));
  const pairs: FfsInteractionPair[] = [];
  const longestMm = sorted.reduce((max, item) => Math.max(max, item.nominal.length), 0);
  const maxWallMm = sorted.reduce((max, item) => Math.max(max, item.nominal.wall), 0);

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const scanLimitMm = ASME_INTERACTION_SPACING_FACTOR * maxWallMm +
      (a.nominal.length + longestMm) / 2;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const centreGapMm = (numericLd(b) - numericLd(a)) * 1000;
      if (centreGapMm > scanLimitMm) break;
      const axialEdgeGapMm = centreGapMm - (a.nominal.length + b.nominal.length) / 2;
      const thresholdMm = ASME_INTERACTION_SPACING_FACTOR * Math.max(a.nominal.wall, b.nominal.wall);
      if (axialEdgeGapMm > thresholdMm) continue;
      const circumGap = circumferentialEdgeGapMm(a, b);
      if (circumGap !== null && circumGap > thresholdMm) continue;
      pairs.push({
        a,
        b,
        edgeGapMm: axialEdgeGapMm,
        axialEdgeGapMm,
        circumferentialEdgeGapMm: circumGap,
        thresholdMm,
        resolved: circumGap !== null,
      });
    }
  }
  return pairs;
}

function sameCalculationBasis(members: FfsScreenedResult[]): boolean {
  const first = members[0].nominal;
  return members.every(({ nominal }) =>
    nominal.wall === first.wall &&
    nominal.od === first.od &&
    nominal.smys === first.smys &&
    nominal.df === first.df &&
    nominal.p0 === first.p0 &&
    nominal.method === first.method &&
    nominal.saMode === first.saMode
  );
}

function connectedComponents(items: FfsScreenedResult[], pairs: FfsInteractionPair[]): FfsScreenedResult[][] {
  const adjacency = new Map<FfsScreenedResult, Set<FfsScreenedResult>>();
  for (const pair of pairs.filter((candidate) => candidate.resolved)) {
    if (!adjacency.has(pair.a)) adjacency.set(pair.a, new Set());
    if (!adjacency.has(pair.b)) adjacency.set(pair.b, new Set());
    adjacency.get(pair.a)!.add(pair.b);
    adjacency.get(pair.b)!.add(pair.a);
  }
  const components: FfsScreenedResult[][] = [];
  const visited = new Set<FfsScreenedResult>();
  for (const item of items) {
    if (visited.has(item) || !adjacency.has(item)) continue;
    const stack = [item];
    const component: FfsScreenedResult[] = [];
    visited.add(item);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          stack.push(neighbour);
        }
      }
    }
    if (component.length > 1) components.push(component);
  }
  return components;
}

/** Recalculates every resolved colony as one conservative rectangular envelope. */
export function buildInteractionAssessments(items: FfsScreenedResult[]): FfsInteractionAssessment[] {
  const pairs = findInteractionPairs(items);
  const assessments: FfsInteractionAssessment[] = [];

  for (const pair of pairs.filter((candidate) => !candidate.resolved)) {
    assessments.push({
      id: `INT-${assessments.length + 1}`,
      members: [pair.a, pair.b],
      pairs: [pair],
      resolved: false,
      combinedLengthMm: null,
      combinedDepthPct: null,
      evaluation: null,
      status: 'unresolved',
      reason: 'Clock position is missing, so circumferential separation cannot be verified.',
    });
  }

  for (const component of connectedComponents(items, pairs)) {
    const members = [...component].sort((a, b) => numericLd(a) - numericLd(b));
    const memberSet = new Set(members);
    const componentPairs = pairs.filter((pair) =>
      pair.resolved && memberSet.has(pair.a) && memberSet.has(pair.b));
    const first = members[0].nominal;
    const left = Math.min(...members.map((item) => numericLd(item) * 1000 - item.nominal.length / 2));
    const right = Math.max(...members.map((item) => numericLd(item) * 1000 + item.nominal.length / 2));
    const combinedLengthMm = right - left;
    const combinedDepthPct = Math.max(...members.map((item) => item.nominal.maxDepthPct));

    if (!sameCalculationBasis(members)) {
      assessments.push({
        id: `INT-${assessments.length + 1}`,
        members,
        pairs: componentPairs,
        resolved: false,
        combinedLengthMm,
        combinedDepthPct,
        evaluation: null,
        status: 'unresolved',
        reason: 'Interacting features do not share one wall, OD, material, pressure, safety factor, and method basis.',
      });
      continue;
    }

    const evaluation = evaluateB31g(
      (combinedDepthPct / 100) * first.wall,
      combinedLengthMm,
      {
        wallThickness: first.wall,
        outerDiameter: first.od,
        smysMpa: first.smys,
        designFactor: first.df,
        operatingPressureMpa: first.p0,
      },
      first.method,
      first.saMode,
    );
    const failed = !evaluation.valid || evaluation.erf >= 1;
    assessments.push({
      id: `INT-${assessments.length + 1}`,
      members,
      pairs: componentPairs,
      resolved: true,
      combinedLengthMm,
      combinedDepthPct,
      evaluation,
      status: failed ? 'fail' : 'pass',
      reason: failed
        ? 'Combined-flaw ERF reaches or exceeds the safe-pressure limit.'
        : 'Combined-flaw ERF remains below the safe-pressure limit.',
    });
  }

  return assessments;
}

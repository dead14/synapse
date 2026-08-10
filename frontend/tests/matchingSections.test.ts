import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteMatchingSection,
  resolveSectionDistances,
  saveSectionRange,
  sectionNameForComparisonRow,
  validateSectionOrder,
  type SectionBoundary,
  type LockedGwPair,
  type MatchingSection,
} from '../src/wizard/matchingSections.ts';

const lockedGws: LockedGwPair[] = [
  { key: 'A', oldId: 'OLD-A', newId: 'NEW-A', oldDistance: 0, newDistance: 0 },
  { key: 'B', oldId: 'OLD-B', newId: 'NEW-B', oldDistance: 10, newDistance: 10 },
  { key: 'C', oldId: 'OLD-C', newId: 'NEW-C', oldDistance: 20, newDistance: 20 },
  { key: 'D', oldId: 'OLD-D', newId: 'NEW-D', oldDistance: 30, newDistance: 30 },
];

const boundaries: SectionBoundary[] = [
  ...lockedGws.map((pair) => ({ ...pair, side: 'MATCHED' as const, label: pair.newId, sourceDistance: pair.newDistance })),
  {
    key: 'UNMATCHED::NEW::NEW-X::15.000000',
    side: 'NEW',
    label: 'NEW-X',
    oldId: null,
    newId: 'NEW-X',
    oldDistance: 15,
    newDistance: 15,
    sourceDistance: 15,
  },
].sort((left, right) => left.newDistance - right.newDistance);

test('saveSectionRange creates and edits a weld-bounded section without overlap', () => {
  const fullRange: MatchingSection = {
    id: 'existing', name: 'Existing', policy: 'MATCH', sectionType: 'BUR', startGwKey: 'A', endGwKey: 'D',
  };
  const inserted = saveSectionRange([fullRange], {
    id: 'new', name: 'Crossing', policy: 'REVIEW', sectionType: 'ROC', startGwKey: 'B', endGwKey: 'C',
  }, lockedGws);

  assert.deepEqual(inserted.map((section) => [section.name, section.startGwKey, section.endGwKey]), [
    ['Existing', 'A', 'B'],
    ['Crossing', 'B', 'C'],
    ['Existing', 'C', 'D'],
  ]);

  const edited = saveSectionRange(inserted, {
    id: 'new', name: 'Crossing revised', policy: 'MATCH', sectionType: 'ROC', startGwKey: 'B', endGwKey: 'D',
  }, lockedGws);

  assert.deepEqual(edited.map((section) => [section.name, section.startGwKey, section.endGwKey]), [
    ['Existing', 'A', 'B'],
    ['Crossing revised', 'B', 'D'],
  ]);
});

test('deleteMatchingSection removes only the selected section', () => {
  const sections: MatchingSection[] = [
    { id: 'first', name: 'First', policy: 'MATCH', startGwKey: 'A', endGwKey: 'B' },
    { id: 'second', name: 'Second', policy: 'REVIEW', startGwKey: 'B', endGwKey: 'C' },
  ];

  assert.deepEqual(deleteMatchingSection(sections, 'first').map((section) => section.id), ['second']);
});

test('an explicit unmatched boundary can create and resolve a section range', () => {
  const section: MatchingSection = {
    id: 'tie-in',
    name: 'Tie-in',
    policy: 'REVIEW',
    startGwKey: 'B',
    endGwKey: 'UNMATCHED::NEW::NEW-X::15.000000',
    startBoundary: boundaries.find((boundary) => boundary.key === 'B'),
    endBoundary: boundaries.find((boundary) => boundary.side === 'NEW'),
  };

  const saved = saveSectionRange([], section, boundaries);
  const resolved = resolveSectionDistances(saved[0], boundaries);

  assert.equal(saved.length, 1);
  assert.equal(resolved.newStartM, 10);
  assert.equal(resolved.newEndM, 15);
  assert.equal(resolved.oldEndM, 15);
});

test('a stale stored projection is replaced by the boundary the current locks produce', () => {
  // What a session saved by a client whose projection disagreed with the
  // contract looks like: the right GW, the wrong counterpart distance.
  const stale: MatchingSection = {
    id: 'tie-in',
    name: 'Tie-in',
    policy: 'MATCH',
    startGwKey: 'B',
    endGwKey: 'UNMATCHED::NEW::NEW-X::15.000000',
    endBoundary: {
      key: 'UNMATCHED::NEW::NEW-X::15.000000',
      side: 'NEW',
      label: 'NEW-X',
      oldId: null,
      newId: 'NEW-X',
      oldDistance: 999,
      newDistance: 15,
      sourceDistance: 15,
    },
  };

  assert.equal(validateSectionOrder([stale], boundaries), null);
  assert.equal(resolveSectionDistances(stale, boundaries).endBoundary?.oldDistance, 15);
});

test('a section bounded by a GW that is no longer locked names the edge to re-pick', () => {
  const orphaned: MatchingSection = {
    id: 'orphan',
    name: 'Orphan',
    policy: 'MATCH',
    startGwKey: 'B',
    endGwKey: 'UNMATCHED::NEW::GONE::40.000000',
    endBoundary: {
      key: 'UNMATCHED::NEW::GONE::40.000000',
      side: 'NEW',
      label: 'GONE',
      oldId: null,
      newId: 'GONE',
      oldDistance: 40,
      newDistance: 40,
      sourceDistance: 40,
    },
  };

  assert.match(validateSectionOrder([orphaned], boundaries) ?? '', /end GW is no longer in the lock list/);
});

test('a boundary that projects off the aligned range is rejected before it can be saved', () => {
  const offRange: MatchingSection = {
    id: 'off-range',
    name: 'Off range',
    policy: 'MATCH',
    startGwKey: 'A',
    endGwKey: 'UNMATCHED::OLD::OLD-Y::5.000000',
    endBoundary: {
      key: 'UNMATCHED::OLD::OLD-Y::5.000000',
      side: 'OLD',
      label: 'OLD-Y',
      oldId: 'OLD-Y',
      newId: null,
      oldDistance: 5,
      newDistance: -12,
      sourceDistance: 5,
    },
  };

  assert.match(
    validateSectionOrder([offRange], [...boundaries, offRange.endBoundary!]) ?? '',
    /projects outside the aligned range/,
  );
});

test('assigns unmatched OLD and NEW features to the section whose side-specific range they cross', () => {
  const sections: MatchingSection[] = [{
    id: 'hl279',
    name: 'HL279',
    policy: 'MATCH',
    startGwKey: 'A',
    endGwKey: 'B',
    oldStartM: 85.78,
    oldEndM: 88.83,
    newStartM: 85.467,
    newEndM: 88.536,
  }];

  assert.equal(sectionNameForComparisonRow({
    'Log Dist OLD (m)': 86.42,
    'Log Dist NEW (m)': '-',
    'Feature Type OLD': 'bend',
  }, sections), 'HL279');

  assert.equal(sectionNameForComparisonRow({
    'Log Dist OLD (m)': '-',
    'Log Dist NEW (m)': 86.398,
    'Feature Type NEW': 'offtake tee',
  }, sections), 'HL279');

  assert.equal(sectionNameForComparisonRow({
    'Log Dist OLD (m)': 90,
    'Log Dist NEW (m)': '-',
    'Feature Type OLD': 'marker',
  }, sections), '-');
});

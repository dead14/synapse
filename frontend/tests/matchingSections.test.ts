import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteMatchingSection,
  saveSectionRange,
  type LockedGwPair,
  type MatchingSection,
} from '../src/wizard/matchingSections.ts';

const lockedGws: LockedGwPair[] = [
  { key: 'A', oldId: 'OLD-A', newId: 'NEW-A', oldDistance: 0, newDistance: 0 },
  { key: 'B', oldId: 'OLD-B', newId: 'NEW-B', oldDistance: 10, newDistance: 10 },
  { key: 'C', oldId: 'OLD-C', newId: 'NEW-C', oldDistance: 20, newDistance: 20 },
  { key: 'D', oldId: 'OLD-D', newId: 'NEW-D', oldDistance: 30, newDistance: 30 },
];

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

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ALIGNMENT_ANCHOR_FEATURE_TYPES,
    alignmentAnchorSqlPredicate,
    canonicalAlignmentAnchorType,
} = require('../src/modules/alignment/alignmentAnchorTypes');

test('persisted parser labels are recognized as canonical alignment anchors', () => {
    assert.equal(canonicalAlignmentAnchorType('Girth Weld'), 'Weld');
    assert.equal(canonicalAlignmentAnchorType('Weld'), 'Weld');
    assert.equal(canonicalAlignmentAnchorType('Joint Flange'), 'Flange');
    assert.equal(canonicalAlignmentAnchorType('Weld', 'Flanged'), 'Flange');
    assert.equal(canonicalAlignmentAnchorType('Weld', 'Valve pipe'), 'Weld');
    assert.equal(canonicalAlignmentAnchorType('Valve'), 'Valve');
    assert.equal(canonicalAlignmentAnchorType('Tee / Branch Connection'), 'Tee');
    assert.equal(canonicalAlignmentAnchorType('Tee'), 'Tee');
    assert.equal(canonicalAlignmentAnchorType('Offtake'), 'Tee');
    assert.equal(canonicalAlignmentAnchorType('Bend'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Elbow'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Jog'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Launcher'), 'Launcher');
    assert.equal(canonicalAlignmentAnchorType('Receiver'), 'Receiver');
    assert.equal(canonicalAlignmentAnchorType('Metal Loss'), null);
    assert.equal(canonicalAlignmentAnchorType('Steel Sleeve'), null);
});

test('fallback identification is used only for unclassified feature types', () => {
    assert.equal(canonicalAlignmentAnchorType('Other', 'Girth weld'), 'Weld');
    assert.equal(canonicalAlignmentAnchorType('', 'Field tee'), 'Tee');
    assert.equal(canonicalAlignmentAnchorType('Other', 'Bend begin'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Other', 'Pipeline elbow'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('', 'Pipe jog'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Metal Loss', 'Near girth weld'), null);
});

test('database anchor filter contains every persisted parser label', () => {
    assert.deepEqual(ALIGNMENT_ANCHOR_FEATURE_TYPES, [
        'Weld',
        'Girth Weld',
        'Flange',
        'Joint Flange',
        'Valve',
        'Tee',
        'Tee / Branch Connection',
        'Offtake',
        'Bend',
        'Elbow',
        'Jog',
        'Launcher',
        'Receiver',
    ]);
});

test('shared anchor SQL predicate keeps unclassified bend labels in sectioning evidence', () => {
    const predicate = alignmentAnchorSqlPredicate('f');

    assert.match(predicate, /f\.feature_type IN/);
    assert.doesNotMatch(predicate, /LOWER\(/);
    assert.match(predicate, /bend\|elbow\|jog/);
    assert.match(predicate, /f\.feature_identification/);
});

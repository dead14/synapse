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
    assert.equal(canonicalAlignmentAnchorType('Bend / Elbow'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('BEND 45 DEG'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Elbow'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Jog'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Launcher'), 'Launcher');
    assert.equal(canonicalAlignmentAnchorType('Receiver'), 'Receiver');
    assert.equal(canonicalAlignmentAnchorType('Metal Loss'), null);
    assert.equal(canonicalAlignmentAnchorType('Steel Sleeve'), null);
});

test('fallback identification is used only for unclassified or generic component types', () => {
    assert.equal(canonicalAlignmentAnchorType('Other', 'Girth weld'), 'Weld');
    assert.equal(canonicalAlignmentAnchorType('', 'Field tee'), 'Tee');
    assert.equal(canonicalAlignmentAnchorType('Other', 'Bend begin'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Other', 'Pipeline elbow'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('', 'Pipe jog'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Fitting', 'Bend 45 DEG'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Pipeline Component', 'Elbow right'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Component (General)', 'Bend Begin'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Fitting', 'Bend-related corrosion'), null);
    assert.equal(canonicalAlignmentAnchorType('Unknown', 'Bend Begin'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Unclassified', 'Elbow right'), 'Bend');
    assert.equal(canonicalAlignmentAnchorType('Bend-related corrosion'), null);
    assert.equal(canonicalAlignmentAnchorType('Fitting', 'Metal-loss near bend'), null);
    assert.equal(canonicalAlignmentAnchorType('Metal Loss', 'Near girth weld'), null);
    assert.equal(canonicalAlignmentAnchorType('Metal Loss', 'Flanged'), null);
    assert.equal(canonicalAlignmentAnchorType('Seamless Pipe'), null);
    assert.equal(canonicalAlignmentAnchorType('Cluster near girth weld'), null);
    assert.equal(canonicalAlignmentAnchorType('Lamination at seam'), null);
    assert.equal(canonicalAlignmentAnchorType('BEND_BEGIN'), null);
    assert.equal(canonicalAlignmentAnchorType('OFF TAKE'), null);
    assert.equal(canonicalAlignmentAnchorType('OFF-TAKE'), null);
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
        'Bend / Elbow',
        'Elbow',
        'Jog',
        'Launcher',
        'Receiver',
    ]);
});

test('shared anchor SQL predicate keeps unclassified bend labels in sectioning evidence', () => {
    const predicate = alignmentAnchorSqlPredicate('f');

    assert.match(predicate, /LOWER\(BTRIM\(COALESCE\(f\.feature_type/);
    assert.match(predicate, /bend\|elbow\|jog/);
    assert.match(predicate, /f\.feature_identification/);
});

test('shared anchor SQL predicate keeps legacy case and qualified feature type labels', () => {
    const predicate = alignmentAnchorSqlPredicate('f');

    assert.ok(predicate.includes(
        "^[[:space:]]*((pipeline|pipe|field|shop|girth|long|longitudinal|circumferential|spiral)[[:space:]-]+)?(weld|seam|valve|tee|offtake|branch([[:space:]]+connection)?|bend|elbow|jog|flang(e|ed)|launcher|receiver)",
    ));
    assert.match(predicate, /other\|fitting\|component\|pipeline/);
    assert.ok(predicate.includes('component[[:space:]]*[(]general[)]'));
    assert.ok(predicate.includes('unknown|unclassified'));
    assert.ok(predicate.includes('metal[[:space:]_-]+loss'));
    assert.equal((predicate.match(/!~\*/g) || []).length, 2);
});

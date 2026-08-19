const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parsePipelineSpecification,
} = require('../src/modules/pipelines/pipelineSpecContract');

test('a blank field is stored as not recorded, never as a zero', () => {
    const specification = parsePipelineSpecification({
        outerDiameterMm: '',
        smysMpa: null,
        designFactor: undefined,
        maopMpa: '',
    });

    assert.equal(specification.outerDiameterMm, null);
    assert.equal(specification.smysMpa, null);
    assert.equal(specification.designFactor, null);
    assert.equal(specification.maopMpa, null);
    assert.deepEqual(specification.segments, []);
});

test('a value that is present but unusable is rejected rather than nulled', () => {
    assert.throws(
        () => parsePipelineSpecification({ outerDiameterMm: 'twenty inches' }),
        /outer diameter must be a number/,
    );
});

test('a diameter below line pipe is refused', () => {
    assert.throws(
        () => parsePipelineSpecification({ outerDiameterMm: 20 }),
        /outer diameter must be at least 50/,
    );
});

test('a design factor outside 0 to 1 is refused', () => {
    assert.throws(
        () => parsePipelineSpecification({ designFactor: 1.2 }),
        /design factor must be at most 1/,
    );
});

test('a wall that leaves no bore is caught before it reaches the Folias term', () => {
    assert.throws(
        () => parsePipelineSpecification({ outerDiameterMm: 100, nominalWallThicknessMm: 60 }),
        /leaves no bore/,
    );
});

test('the register is numbered in the order it arrives', () => {
    const specification = parsePipelineSpecification({
        outerDiameterMm: 508,
        segments: [
            { label: '20 in', startM: 0, endM: 12000, outerDiameterMm: 508 },
            { label: '24 in', startM: 12000, outerDiameterMm: 610, designFactor: 0.6 },
        ],
    });

    assert.equal(specification.segments.length, 2);
    assert.deepEqual(specification.segments.map((segment) => segment.position), [0, 1]);
    assert.equal(specification.segments[1].outerDiameterMm, 610);
    assert.equal(specification.segments[1].endM, null, 'an open-ended stretch reaches the end of the line');
    assert.equal(specification.segments[1].designFactor, 0.6);
});

test('a stretch that ends before it starts is refused', () => {
    assert.throws(
        () => parsePipelineSpecification({
            segments: [{ label: 'backwards', startM: 9000, endM: 4000 }],
        }),
        /must end after it starts/,
    );
});

test('an unnamed stretch is given the position it holds', () => {
    const specification = parsePipelineSpecification({ segments: [{ startM: 0, endM: 100 }] });
    assert.equal(specification.segments[0].label, 'Segment 1');
});

test('a year outside the plausible window is refused', () => {
    assert.throws(
        () => parsePipelineSpecification({ commissioningYear: 95 }),
        /commissioning year must be at least 1900/,
    );
});

test('more segments than a line can carry is refused', () => {
    const segments = Array.from({ length: 41 }, (_unused, index) => ({ label: `s${index}` }));
    assert.throws(() => parsePipelineSpecification({ segments }), /at most 40 segments/);
});

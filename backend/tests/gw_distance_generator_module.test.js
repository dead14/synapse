const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { generatorTimeoutMs } = require('../src/modules/alignment/gwDistanceGenerator');

const BACKEND_ROOT = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(BACKEND_ROOT, relativePath), 'utf8');
}

test('the generator script the module spawns exists', () => {
    const source = read('src/modules/alignment/gwDistanceGenerator.js');
    const script = source.match(/GENERATOR_SCRIPT = '([^']+)'/)?.[1];

    assert.ok(script, 'GENERATOR_SCRIPT should be declared');
    assert.ok(fs.existsSync(path.join(BACKEND_ROOT, script)), script);
});

test('the timeout is configurable and defaults to something bounded', () => {
    assert.equal(generatorTimeoutMs({ GW_DISTANCE_GENERATOR_TIMEOUT_MS: '1000' }), 1000);
    assert.equal(generatorTimeoutMs({}), 5 * 60 * 1000);
    // A wedged process must not hold the request open forever.
    assert.equal(generatorTimeoutMs({ GW_DISTANCE_GENERATOR_TIMEOUT_MS: '-1' }), 5 * 60 * 1000);
    assert.equal(generatorTimeoutMs({ GW_DISTANCE_GENERATOR_TIMEOUT_MS: 'soon' }), 5 * 60 * 1000);
});

test('run ownership is resolved through the pipeline, not taken on trust', () => {
    // survey_runs carries no organization of its own. Without the join a run id
    // from one tenant would let the generator rewrite another tenant's features.
    const source = read('src/modules/alignment/gwDistanceGenerator.js');

    assert.match(source, /JOIN pipelines p ON p\.id = r\.pipeline_id/);
    assert.match(source, /p\.organization_id = \$2/);
});

test('both endpoints check ownership before spawning the generator', () => {
    const controller = read('src/modules/alignment/alignmentController.js');

    for (const handler of ['previewGwDistance', 'generateGwDistance']) {
        const body = controller.slice(
            controller.indexOf(`exports.${handler} =`),
            controller.indexOf('};', controller.indexOf(`exports.${handler} =`)),
        );
        assert.ok(body.length > 0, `${handler} should exist`);
        assert.match(body, /findOwnedRun\(pool, runId, req\.user\.orgId\)/, handler);
        assert.ok(
            body.indexOf('findOwnedRun') < body.indexOf('runGwDistanceGenerator'),
            `${handler} must resolve ownership before running the generator`,
        );
    }
});

test('the preview endpoint never applies', () => {
    const controller = read('src/modules/alignment/alignmentController.js');
    const preview = controller.slice(
        controller.indexOf('exports.previewGwDistance ='),
        controller.indexOf('exports.generateGwDistance ='),
    );

    assert.match(preview, /apply: false/);
    assert.doesNotMatch(preview, /apply: true/);
});

test('the migration adds derived columns without touching the vendor one', () => {
    const migration = read('migrations/014_derived_us_gw_distance.sql');

    assert.match(migration, /ADD COLUMN IF NOT EXISTS dist_to_us_gw_derived_m/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS us_gw_reference_m/);
    // The whole point of the separate column: the surveyed reading survives.
    assert.doesNotMatch(migration, /DROP COLUMN|ALTER COLUMN dist_to_us_gw_m|UPDATE ili_features/);
});

test('the ORM model and the migration agree on the new columns', () => {
    const models = read('src/python_engines/models.py');

    for (const column of ['dist_to_us_gw_derived_m', 'us_gw_reference_m']) {
        assert.match(models, new RegExp(`${column} = Column\\(Float\\)`), column);
    }
    assert.match(models, /__tablename__ = 'run_gw_distance_generation'/);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const { downloadTemplate } = require('../src/modules/ffs/ffsController');
const { generateTemplateWorkbook } = require('../src/modules/ffs/templateGenerator');

test('ILI template generator returns an XLSX workbook buffer', async () => {
    const buffer = await generateTemplateWorkbook();

    assert.ok(Buffer.isBuffer(buffer));
    assert.ok(buffer.length > 1000);
    assert.equal(buffer.subarray(0, 2).toString('utf8'), 'PK');
});

test('download template handler sends the XLSX workbook response', async () => {
    const headers = {};
    const response = {
        statusCode: 200,
        body: undefined,
        setHeader(name, value) {
            headers[name] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        },
    };

    await downloadTemplate({}, response);

    assert.equal(response.statusCode, 200);
    assert.equal(headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.equal(headers['Content-Disposition'], 'attachment; filename="ILI_Template.xlsx"');
    assert.ok(Buffer.isBuffer(response.body));
    assert.equal(response.body.subarray(0, 2).toString('utf8'), 'PK');
});

const HEADERS = [
    'feature_id', 'log_distance_m', 'joint_number', 'dist_to_us_gw_m', 'joint_length_m', 'feature_type',
    'feature_identification', 'dim_classification', 'clock_position', 'wall_thickness_mm', 'length_mm',
    'width_mm', 'depth_pct', 'surface_location', 'erf_asme', 'psafe_bar', 'comment',
];

const ROWS = [
    [1, 10.5, 1, 0.5, 12.0, 'Weld', '', '', '12:00', 10.0, '', '', '', '', '', '', ''],
    [2, 15.2, 1, 5.2, 12.0, 'Metal Loss', 'Corrosion', '', '03:00', 10.0, 50, 40, 15, 'External', '', '', ''],
    [3, 22.5, 2, 10.5, 12.0, 'Weld', '', '', '12:00', 10.0, '', '', '', '', '', '', ''],
    [4, 28.4, 2, 4.4, 12.0, 'Metal Loss', 'Pitting', '', '06:30', 10.0, 20, 20, 35, 'Internal', '', '', ''],
    [5, 34.5, 3, 10.5, 12.0, 'Weld', '', '', '12:00', 10.0, '', '', '', '', '', '', ''],
    [6, 41.2, 3, 6.7, 12.0, 'Tee', '', '', '09:00', 10.0, '', '', '', '', '', '', ''],
    [7, 46.5, 4, 5.3, 12.0, 'Metal Loss', 'Corrosion', '', '01:15', 10.0, 150, 80, 45, 'External', '', '', ''],
    [8, 58.5, 5, 12.0, 12.0, 'Weld', '', '', '12:00', 10.0, '', '', '', '', '', '', ''],
];

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    return crc >>> 0;
});

function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function columnName(index) {
    let name = '';
    let value = index;
    while (value > 0) {
        const remainder = (value - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        value = Math.floor((value - 1) / 26);
    }
    return name;
}

function cellXml(value, rowIndex, columnIndex) {
    const reference = `${columnName(columnIndex)}${rowIndex}`;
    if (value === '' || value === null || value === undefined) {
        return `<c r="${reference}"/>`;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${reference}"><v>${value}</v></c>`;
    }
    return `<c r="${reference}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function rowXml(row, rowIndex, styleId = 0) {
    const style = styleId ? ` s="${styleId}"` : '';
    return `<row r="${rowIndex}">${row.map((value, index) => {
        const cell = cellXml(value, rowIndex, index + 1);
        return styleId ? cell.replace('<c ', `<c${style} `) : cell;
    }).join('')}</row>`;
}

function buildWorksheetXml() {
    const rows = [rowXml(HEADERS, 1, 1), ...ROWS.map((row, index) => rowXml(row, index + 2))].join('');
    const cols = HEADERS.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="22" customWidth="1"/>`).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${cols}</cols>
  <sheetData>${rows}</sheetData>
</worksheet>`;
}

function writeUInt16(value) {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16LE(value);
    return buffer;
}

function writeUInt32(value) {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value >>> 0);
    return buffer;
}

function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const nameBuffer = Buffer.from(file.name, 'utf8');
        const dataBuffer = Buffer.from(file.content, 'utf8');
        const crc = crc32(dataBuffer);

        const localHeader = Buffer.concat([
            writeUInt32(0x04034B50),
            writeUInt16(20),
            writeUInt16(0),
            writeUInt16(0),
            writeUInt16(0),
            writeUInt16(0),
            writeUInt32(crc),
            writeUInt32(dataBuffer.length),
            writeUInt32(dataBuffer.length),
            writeUInt16(nameBuffer.length),
            writeUInt16(0),
            nameBuffer,
        ]);
        localParts.push(localHeader, dataBuffer);

        const centralHeader = Buffer.concat([
            writeUInt32(0x02014B50),
            writeUInt16(20),
            writeUInt16(20),
            writeUInt16(0),
            writeUInt16(0),
            writeUInt16(0),
            writeUInt16(0),
            writeUInt32(crc),
            writeUInt32(dataBuffer.length),
            writeUInt32(dataBuffer.length),
            writeUInt16(nameBuffer.length),
            writeUInt16(0),
            writeUInt16(0),
            writeUInt16(0),
            writeUInt16(0),
            writeUInt32(0),
            writeUInt32(offset),
            nameBuffer,
        ]);
        centralParts.push(centralHeader);
        offset += localHeader.length + dataBuffer.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const endRecord = Buffer.concat([
        writeUInt32(0x06054B50),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(files.length),
        writeUInt16(files.length),
        writeUInt32(centralDirectory.length),
        writeUInt32(offset),
        writeUInt16(0),
    ]);

    return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

async function generateTemplateWorkbook() {
    return createZip([
        {
            name: '[Content_Types].xml',
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
        },
        {
            name: '_rels/.rels',
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
        },
        {
            name: 'xl/workbook.xml',
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="ILI Template" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
        },
        {
            name: 'xl/_rels/workbook.xml.rels',
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
        },
        {
            name: 'xl/styles.xml',
            content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`,
        },
        {
            name: 'xl/worksheets/sheet1.xml',
            content: buildWorksheetXml(),
        },
    ]);
}

module.exports = {
    generateTemplateWorkbook,
};

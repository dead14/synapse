import { strFromU8, unzipSync } from 'fflate';

type CellValue = string | number | boolean | null;

function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const parserError = document.getElementsByTagName('parsererror')[0];
  if (parserError) throw new Error(parserError.textContent || 'Invalid workbook XML.');
  return document;
}

function columnIndex(reference: string): number {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function textContent(node: Element | null): string {
  return node?.textContent ?? '';
}

function parseSharedStrings(xml?: string): string[] {
  if (!xml) return [];
  const document = parseXml(xml);
  return Array.from(document.getElementsByTagName('si')).map((item) => (
    Array.from(item.getElementsByTagName('t')).map(textContent).join('')
  ));
}

function parseCellValue(cell: Element, sharedStrings: string[]): CellValue {
  const type = cell.getAttribute('t');

  if (type === 'inlineStr') {
    return Array.from(cell.getElementsByTagName('t')).map(textContent).join('');
  }

  const rawValue = textContent(cell.getElementsByTagName('v')[0]);
  if (!rawValue) return null;

  if (type === 's') {
    return sharedStrings[Number(rawValue)] ?? '';
  }
  if (type === 'b') {
    return rawValue === '1';
  }
  if (type === 'str') {
    return rawValue;
  }

  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : rawValue;
}

function worksheetPath(files: Record<string, Uint8Array>): string {
  if (files['xl/worksheets/sheet1.xml']) return 'xl/worksheets/sheet1.xml';

  const firstWorksheet = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort()[0];

  if (!firstWorksheet) throw new Error('Workbook tidak memiliki worksheet.');
  return firstWorksheet;
}

export async function readXlsxRows(file: File): Promise<Record<string, CellValue>[]> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const decode = (name: string) => files[name] ? strFromU8(files[name]) : undefined;
  const sharedStrings = parseSharedStrings(decode('xl/sharedStrings.xml'));
  const worksheetXml = decode(worksheetPath(files));
  if (!worksheetXml) throw new Error('Worksheet tidak dapat dibaca.');

  const worksheet = parseXml(worksheetXml);
  const rows = Array.from(worksheet.getElementsByTagName('row')).map((row) => {
    const values: CellValue[] = [];
    Array.from(row.getElementsByTagName('c')).forEach((cell) => {
      const reference = cell.getAttribute('r') || '';
      values[columnIndex(reference)] = parseCellValue(cell, sharedStrings);
    });
    return values;
  });

  const headerRow = rows.find((row) => row.some((value) => value !== null && value !== undefined && value !== ''));
  if (!headerRow) throw new Error('Baris header tidak ditemukan.');

  const headerIndex = rows.indexOf(headerRow);
  const headers = headerRow.map((value, index) => String(value || `Column ${index + 1}`).trim());

  return rows.slice(headerIndex + 1)
    .filter((row) => row.some((value) => value !== null && value !== undefined && value !== ''))
    .map((row) => {
      const record: Record<string, CellValue> = {};
      headers.forEach((header, index) => {
        if (header) record[header] = row[index] ?? null;
      });
      return record;
    });
}

import { REQUIRED_COLUMNS } from './types';

export function downloadCsvTemplate() {
  const headers = REQUIRED_COLUMNS.join(',');
  const sampleRows = [
    '100.5,Joint-1,Internal,25.3,45.2,30.1,6:00,12.7,0.15,0.05,0.72,508,358,6.5',
    '240.2,Joint-2,External,12.5,20.0,15.0,3:30,12.7,0.10,0.05,0.72,508,358,6.5',
    '500.8,Joint-5,Internal,48.0,120.5,40.0,12:00,12.7,0.20,0.10,0.72,508,358,6.5',
    '1050.0,Joint-10,External,35.5,85.0,25.5,9:15,12.7,0.15,0.08,0.72,508,358,6.5',
    '2100.4,Joint-22,Internal,65.2,205.0,55.0,6:45,12.7,0.25,0.12,0.72,508,358,6.5'
  ];
  const csv = 'sep=,\n' + headers + '\n' + sampleRows.join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'FFS_Assessment_Template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

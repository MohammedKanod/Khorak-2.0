/** Quote all cells and neutralise spreadsheet formula prefixes. */
export function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(value => {
    let cell = String(value ?? '');
    if (/^[=+@\-\t\r]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

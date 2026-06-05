export function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export function table(rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    console.log('(empty)');
    return;
  }

  const columns = Object.keys(rows[0]);
  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => String(row[column] ?? '').length))
  );

  console.log(columns.map((column, index) => column.padEnd(widths[index])).join('  '));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) {
    console.log(columns.map((column, index) => String(row[column] ?? '').padEnd(widths[index])).join('  '));
  }
}

export function truncate(value: unknown, max = 72) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function maskSecret(value: unknown, visible = 4) {
  const text = String(value ?? '');
  if (!text) return '(not set)';
  if (text.length <= visible * 2) return `${text[0]}...${text[text.length - 1]}`;
  return `${text.slice(0, visible)}...${text.slice(-visible)}`;
}

export interface CsvOptions {
  delimiter?: string;
  headers?: string[];
  mapping?: Record<string, string>;
}

export async function* parseCsv(
  lines: AsyncIterable<string>,
  opts: CsvOptions = {},
): AsyncIterable<Record<string, string>> {
  const delimiter = opts.delimiter ?? ',';
  let headers = opts.headers;
  let isFirst = true;
  for await (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!headers) {
      headers = line.split(delimiter).map((h) => h.trim());
      isFirst = false;
      continue;
    }
    if (isFirst) {
      isFirst = false;
      if (opts.headers) {
        // line belongs to data even if headers provided
      } else {
        continue; // we already consumed first line as headers
      }
    }
    const cells = line.split(delimiter).map((c) => c.trim());
    const record: Record<string, string> = {};
    const hdrs = headers!;
    hdrs.forEach((h, i) => {
      record[h] = cells[i] ?? '';
    });
    if (opts.mapping) {
      const mapped: Record<string, string> = {};
      for (const [key, col] of Object.entries(opts.mapping)) {
        if (col && record[col] !== undefined) {
          mapped[key] = record[col];
        }
      }
      yield mapped;
    } else {
      yield record;
    }
  }
}

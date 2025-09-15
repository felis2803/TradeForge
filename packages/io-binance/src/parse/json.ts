/* eslint-disable */
export interface JsonOptions {
  maxBytes?: number;
}

export async function* parseJson(
  lines: AsyncIterable<string>,
  opts: JsonOptions = {},
): AsyncIterable<unknown> {
  const maxBytes = opts.maxBytes ?? 1_000_000; // 1MB
  let size = 0;
  let content = '';
  for await (const chunk of lines) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error('json: file too large for eager parse');
    }
    content += chunk;
  }
  if (!content.trim()) return;
  const data = JSON.parse(content);
  if (Array.isArray(data)) {
    for (const item of data) {
      yield item as any;
    }
  } else {
    yield data as any;
  }
}

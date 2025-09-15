/* eslint-disable */
export async function* parseJsonl(
  lines: AsyncIterable<string>,
): AsyncIterable<unknown> {
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    yield JSON.parse(line) as any;
  }
}

/**
 * Camera kits.
 *
 * Bolt6 runs several kits, each holding around 60 numbered cameras. A plan is
 * built against one kit, and any camera in that kit that is broken or missing
 * must not be handed out — by the auto-assigner or by the number picker.
 *
 * Unavailable numbers are typed as free text ("7, 23, 41-44") because that is
 * how the list actually arrives: someone reads it off a flight case.
 */

/** "7, 23, 41-44" -> [7, 23, 41, 42, 43, 44]. Tolerant of any separator. */
export function parseNumberList(text, max = 999) {
  if (!text) return [];
  const found = new Set();

  for (const chunk of String(text).split(/[^0-9-]+/)) {
    if (!chunk) continue;
    const range = chunk.match(/^(\d+)-(\d+)$/);
    if (range) {
      const from = Math.min(+range[1], +range[2]);
      const to = Math.max(+range[1], +range[2]);
      for (let n = from; n <= to; n++) if (n >= 1 && n <= max) found.add(n);
      continue;
    }
    const single = chunk.match(/^\d+$/);
    if (single) {
      const n = +single[0];
      if (n >= 1 && n <= max) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** [7, 23, 41, 42, 43, 44] -> "7, 23, 41-44". Round-trips through the parser. */
export function formatNumberList(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j - i >= 2 ? `${sorted[i]}-${sorted[j]}` : sorted.slice(i, j + 1).join(', '));
    i = j + 1;
  }
  return parts.join(', ');
}

/** Numbers this kit can actually supply. */
export function availableNumbers(kit) {
  if (!kit) return [];
  const out = kit.unavailable ?? [];
  const blocked = new Set(out);
  const list = [];
  for (let n = 1; n <= (kit.size ?? 60); n++) if (!blocked.has(n)) list.push(n);
  return list;
}

export const isAvailable = (kit, n) =>
  !!kit && n >= 1 && n <= (kit.size ?? 60) && !(kit.unavailable ?? []).includes(n);

export const newKit = (name, size = 60) => ({ name, size, unavailable: [], notes: '' });

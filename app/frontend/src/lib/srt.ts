export interface SrtCue {
  id: string;
  start: string;
  end: string;
  text: string;
}

const TIMESTAMP_RE = /^(\d{2}:\d{2}:\d{2}),(\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}),(\d{3})$/;

function toDisplay(hms: string, ms: string): string {
  return `${hms}.${ms}`;
}

function toSrt(tc: string): string {
  // HH:MM:SS.mmm -> HH:MM:SS,mmm
  const dot = tc.lastIndexOf('.');
  if (dot === -1) return tc;
  return tc.slice(0, dot) + ',' + tc.slice(dot + 1);
}

export function parseSrt(raw: string): SrtCue[] {
  const blocks = raw.trim().split(/\n\n+/);
  const cues: SrtCue[] = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const tsLine = lines[1].trim();
    const match = tsLine.match(TIMESTAMP_RE);
    if (!match) continue;
    const [, startHms, startMs, endHms, endMs] = match;
    const text = lines.slice(2).join('\n').trim();
    cues.push({
      id: `cue-${cues.length}`,
      start: toDisplay(startHms, startMs),
      end: toDisplay(endHms, endMs),
      text,
    });
  }

  return cues;
}

export function serializeSrt(cues: SrtCue[]): string {
  const sorted = [...cues].sort((a, b) => {
    const aMs = a.start.replace('.', ',');
    const bMs = b.start.replace('.', ',');
    return aMs.localeCompare(bMs);
  });

  return sorted
    .map((cue, i) => `${i + 1}\n${toSrt(cue.start)} --> ${toSrt(cue.end)}\n${cue.text}`)
    .join('\n\n') + '\n';
}

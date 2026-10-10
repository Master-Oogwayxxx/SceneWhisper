import { describe, it, expect } from 'vitest';
import { parseSrt, serializeSrt, SrtCue } from './srt';

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:04,000
Hello world

2
00:00:05,500 --> 00:00:09,000
Second line
with two rows

`;

describe('parseSrt', () => {
  it('parses cues into dot-millisecond timecodes', () => {
    const cues = parseSrt(SAMPLE_SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      start: '00:00:01.000',
      end: '00:00:04.000',
      text: 'Hello world',
    });
    expect(cues[1]).toMatchObject({
      start: '00:00:05.500',
      end: '00:00:09.000',
      text: 'Second line\nwith two rows',
    });
  });

  it('returns stable ids', () => {
    const cues = parseSrt(SAMPLE_SRT);
    expect(cues[0].id).toBe('cue-0');
    expect(cues[1].id).toBe('cue-1');
  });

  it('returns empty array for empty string', () => {
    expect(parseSrt('')).toEqual([]);
  });

  it('skips malformed blocks', () => {
    const bad = `1\nnot-a-timestamp\ntext\n\n`;
    expect(parseSrt(bad)).toEqual([]);
  });
});

describe('serializeSrt', () => {
  it('converts dot timecodes back to comma', () => {
    const cues: SrtCue[] = [
      { id: 'cue-0', start: '00:00:01.000', end: '00:00:04.000', text: 'Hello world' },
    ];
    const out = serializeSrt(cues);
    expect(out).toContain('00:00:01,000 --> 00:00:04,000');
    expect(out).toContain('Hello world');
    expect(out.startsWith('1\n')).toBe(true);
  });

  it('sorts cues by start time and renumbers from 1', () => {
    const cues: SrtCue[] = [
      { id: 'cue-1', start: '00:00:05.000', end: '00:00:09.000', text: 'Second' },
      { id: 'cue-0', start: '00:00:01.000', end: '00:00:04.000', text: 'First' },
    ];
    const out = serializeSrt(cues);
    const lines = out.split('\n');
    expect(lines[0]).toBe('1');
    expect(lines[1]).toContain('00:00:01,000');
  });

  it('round-trips a parsed SRT', () => {
    const cues = parseSrt(SAMPLE_SRT);
    const out = serializeSrt(cues);
    const reparsed = parseSrt(out);
    expect(reparsed).toHaveLength(2);
    expect(reparsed[0].start).toBe(cues[0].start);
    expect(reparsed[1].text).toBe(cues[1].text);
  });
});

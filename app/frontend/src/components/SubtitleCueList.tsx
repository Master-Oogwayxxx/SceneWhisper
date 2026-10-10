import React, { useState } from 'react';
import { SrtCue } from '@/lib/srt';
import { secondsToTimecode, isValidTimecode, timecodeToSeconds } from '@/lib/timecode';
import { copyTextToClipboard } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Copy, Check, Crosshair, Trash2 } from 'lucide-react';

interface SubtitleCueListProps {
  cues: SrtCue[];
  onChange: (cues: SrtCue[]) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  currentTime: number;
}

function hasOverlap(cues: SrtCue[]): boolean {
  const sorted = [...cues]
    .filter(c => isValidTimecode(c.start) && isValidTimecode(c.end))
    .sort((a, b) => timecodeToSeconds(a.start) - timecodeToSeconds(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (timecodeToSeconds(sorted[i].start) < timecodeToSeconds(sorted[i - 1].end)) return true;
  }
  return false;
}

export const SubtitleCueList = ({ cues, onChange, videoRef, currentTime }: SubtitleCueListProps) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const updateCue = (id: string, field: keyof Pick<SrtCue, 'start' | 'end' | 'text'>, value: string) => {
    onChange(cues.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const deleteCue = (id: string) => {
    onChange(cues.filter(c => c.id !== id));
  };

  const addCue = () => {
    const start = secondsToTimecode(currentTime);
    const end = secondsToTimecode(currentTime + 5);
    const newCue: SrtCue = { id: `cue-${Date.now()}`, start, end, text: '' };
    onChange([...cues, newCue]);
  };

  const handleCopy = (text: string, fieldId: string) => {
    copyTextToClipboard(text).then(() => {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    }).catch(() => {
      /* ignore */
    })
  };

  const overlap = hasOverlap(cues);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="space-y-1 flex-1 overflow-y-auto scrollbar">
        <div className="grid grid-cols-[2rem_1fr_2rem_2rem_1fr_2rem_2rem_1fr_2rem] gap-2 px-2 py-1 text-xs font-medium text-muted-foreground border-b">
          <span>#</span>
          <span>Start</span>
          <span />
          <span />
          <span>End</span>
          <span />
          <span />
          <span>Text</span>
          <span />
        </div>

        {cues.map((cue, index) => {
          const startInvalid = cue.start && !isValidTimecode(cue.start);
          const endInvalid = cue.end && !isValidTimecode(cue.end);
          const rangeInvalid =
            isValidTimecode(cue.start) &&
            isValidTimecode(cue.end) &&
            timecodeToSeconds(cue.start) > timecodeToSeconds(cue.end);

          return (
            <div key={cue.id} className="space-y-1">
              <div className="grid grid-cols-[2rem_1fr_2rem_2rem_1fr_2rem_2rem_1fr_2rem] gap-2 px-2 py-1.5 text-sm rounded items-start hover:bg-secondary/50">
                <span className="text-muted-foreground pt-1">{index + 1}</span>

                <Input
                  value={cue.start}
                  onChange={e => updateCue(cue.id, 'start', e.target.value)}
                  placeholder="00:00:00.000"
                  className="h-6 text-sm font-mono px-1"
                />
                <Button variant="ghost" size="icon" className="h-5 w-5 mt-0.5"
                  onClick={() => handleCopy(cue.start, `start-${cue.id}`)}
                  aria-label="Copy start">
                  {copiedField === `start-${cue.id}` ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5 mt-0.5"
                  onClick={() => updateCue(cue.id, 'start', secondsToTimecode(videoRef.current?.currentTime ?? currentTime))}
                  aria-label="Set start to current time">
                  <Crosshair className="h-3 w-3" />
                </Button>

                <Input
                  value={cue.end}
                  onChange={e => updateCue(cue.id, 'end', e.target.value)}
                  placeholder="00:00:00.000"
                  className="h-6 text-sm font-mono px-1"
                />
                <Button variant="ghost" size="icon" className="h-5 w-5 mt-0.5"
                  onClick={() => handleCopy(cue.end, `end-${cue.id}`)}
                  aria-label="Copy end">
                  {copiedField === `end-${cue.id}` ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-5 w-5 mt-0.5"
                  onClick={() => updateCue(cue.id, 'end', secondsToTimecode(videoRef.current?.currentTime ?? currentTime))}
                  aria-label="Set end to current time">
                  <Crosshair className="h-3 w-3" />
                </Button>

                <textarea
                  value={cue.text}
                  onChange={e => updateCue(cue.id, 'text', e.target.value)}
                  rows={Math.min(3, Math.max(1, cue.text.split('\n').length))}
                  className="w-full resize-none rounded-md border border-input bg-background px-1 py-0.5 font-mono text-sm focus:outline-none"
                  spellCheck={false}
                />

                <Button variant="ghost" size="icon" className="h-5 w-5 mt-0.5"
                  onClick={() => deleteCue(cue.id)}
                  aria-label="Delete cue">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              {(startInvalid || endInvalid || rangeInvalid) && (
                <div className="px-2 text-xs text-destructive space-y-0.5">
                  {startInvalid && <div>Start: use HH:MM:SS.mmm (e.g. 00:01:23.456)</div>}
                  {endInvalid && <div>End: use HH:MM:SS.mmm (e.g. 00:01:23.456)</div>}
                  {rangeInvalid && <div>End time must be after start time</div>}
                </div>
              )}
            </div>
          );
        })}

        {cues.length === 0 && (
          <p className="text-muted-foreground text-sm py-4 px-2">No subtitle cues. Click &quot;Add Cue&quot; to create one.</p>
        )}
      </div>

      {overlap && (
        <p className="text-xs text-destructive mt-2">Cues have overlapping timecodes. Fix overlaps before saving.</p>
      )}

      <Button variant="outline" size="sm" className="mt-2 self-start" onClick={addCue}>
        Add Cue
      </Button>
    </div>
  );
};

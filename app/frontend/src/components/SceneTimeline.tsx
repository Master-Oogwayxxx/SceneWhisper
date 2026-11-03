import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Scene } from '@/types/types';
import { isValidTimecode, secondsToTimecode, timecodeToSeconds } from '@/lib/timecode';

interface EditState { start_timecode: string; end_timecode: string; }
interface SceneTimelineProps {
  duration: number; scenes: Scene[]; editStates: Record<string, EditState>; scenesToDelete: Set<string>;
  onUpdateEditState: (id: string, field: keyof EditState, value: string) => void;
  onInitializeEditState: (scene: Scene) => void; currentTime: number; onSeek: (seconds: number) => void;
}

const SCENE_COLORS = [
  { bg: 'bg-blue-500/40', border: 'border-blue-600/80', hover: 'hover:bg-blue-500/50', handle: 'bg-blue-600/80 hover:bg-blue-700' },
  { bg: 'bg-emerald-500/40', border: 'border-emerald-600/80', hover: 'hover:bg-emerald-500/50', handle: 'bg-emerald-600/80 hover:bg-emerald-700' },
  { bg: 'bg-purple-500/40', border: 'border-purple-600/80', hover: 'hover:bg-purple-500/50', handle: 'bg-purple-600/80 hover:bg-purple-700' },
  { bg: 'bg-orange-500/40', border: 'border-orange-600/80', hover: 'hover:bg-orange-500/50', handle: 'bg-orange-600/80 hover:bg-orange-700' },
  { bg: 'bg-pink-500/40', border: 'border-pink-600/80', hover: 'hover:bg-pink-500/50', handle: 'bg-pink-600/80 hover:bg-pink-700' },
  { bg: 'bg-cyan-500/40', border: 'border-cyan-600/80', hover: 'hover:bg-cyan-500/50', handle: 'bg-cyan-600/80 hover:bg-cyan-700' },
];
const formatRulerTime = (seconds: number) => `${Math.floor(Math.max(0, Math.round(seconds)) / 60)}:${String(Math.max(0, Math.round(seconds)) % 60).padStart(2, '0')}`;

export const SceneTimeline = ({ duration, scenes, editStates, scenesToDelete, onUpdateEditState, onInitializeEditState, currentTime, onSeek }: SceneTimelineProps) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const didDragRef = useRef(false);
  const [dragging, setDragging] = useState<{ sceneId: string; edge: 'start' | 'end' } | 'playhead' | null>(null);
  const [hoveredSceneId, setHoveredSceneId] = useState<string | null>(null);

  const allScenes = useMemo(() => {
    const result = scenes?.filter((scene) => !scenesToDelete.has(scene.id)) ?? [];
    Object.entries(editStates).forEach(([id, state]) => {
      if (id.startsWith('new-')) result.push({ id, start_timecode: state.start_timecode, end_timecode: state.end_timecode, scene_number: 0, duration_seconds: 0, file_id: '' } as Scene);
    });
    return result.sort((a, b) => timecodeToSeconds(editStates[a.id]?.start_timecode ?? a.start_timecode) - timecodeToSeconds(editStates[b.id]?.start_timecode ?? b.start_timecode)).map((scene, index) => ({ ...scene, scene_number: index + 1 }));
  }, [scenes, editStates, scenesToDelete]);
  const secondsToPercent = (seconds: number) => (Math.max(0, Math.min(seconds, duration)) / duration) * 100;
  const pixelsToSeconds = (clientX: number) => { const rect = timelineRef.current?.getBoundingClientRect(); if (!rect || rect.width <= 0) return 0; return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration; };
  const getTimecode = (scene: Scene, field: keyof EditState) => { const value = editStates[scene.id]?.[field]; return value && isValidTimecode(value) ? value : scene[field]; };
  const getSeconds = (scene: Scene, field: keyof EditState) => timecodeToSeconds(getTimecode(scene, field));

  const updateBoundary = (clientX: number) => {
    if (!dragging || dragging === 'playhead') return;
    const index = allScenes.findIndex((scene) => scene.id === dragging.sceneId); if (index < 0) return;
    const scene = allScenes[index]; const raw = pixelsToSeconds(clientX); const start = getSeconds(scene, 'start_timecode'); const end = getSeconds(scene, 'end_timecode');
    const previousEnd = index > 0 ? getSeconds(allScenes[index - 1], 'end_timecode') : 0;
    const nextStart = index < allScenes.length - 1 ? getSeconds(allScenes[index + 1], 'start_timecode') : duration;
    const next = dragging.edge === 'start' ? Math.min(end, Math.max(previousEnd, raw)) : Math.max(start, Math.min(nextStart, raw));
    onUpdateEditState(scene.id, dragging.edge === 'start' ? 'start_timecode' : 'end_timecode', secondsToTimecode(next));
  };
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => { didDragRef.current = true; if (dragging === 'playhead') onSeek(pixelsToSeconds(event.clientX)); else updateBoundary(event.clientX); };
    const end = () => setDragging(null);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); };
  }, [dragging, duration, allScenes, editStates]);
  const adjustBoundary = (scene: Scene, edge: 'start' | 'end', delta: number) => {
    onInitializeEditState(scene); const index = allScenes.findIndex((item) => item.id === scene.id); const current = getSeconds(scene, edge === 'start' ? 'start_timecode' : 'end_timecode');
    const start = getSeconds(scene, 'start_timecode'); const end = getSeconds(scene, 'end_timecode'); const previousEnd = index > 0 ? getSeconds(allScenes[index - 1], 'end_timecode') : 0; const nextStart = index < allScenes.length - 1 ? getSeconds(allScenes[index + 1], 'start_timecode') : duration;
    const next = edge === 'start' ? Math.min(end, Math.max(previousEnd, current + delta)) : Math.max(start, Math.min(nextStart, current + delta));
    onUpdateEditState(scene.id, edge === 'start' ? 'start_timecode' : 'end_timecode', secondsToTimecode(next));
  };
  if (duration <= 0) return <div className="w-full h-16 bg-secondary/30 flex items-center justify-center text-xs text-muted-foreground">Video duration unavailable</div>;
  const tickCount = Math.min(12, Math.max(2, Math.ceil(duration / 30) + 1)); const ticks = Array.from({ length: tickCount }, (_, index) => (duration * index) / (tickCount - 1));

  return <div className="relative w-full h-20 overflow-visible select-none" aria-label="Scene timeline">
    <div className="absolute inset-x-0 top-0 h-5 text-[10px] text-muted-foreground font-mono" aria-hidden="true">{ticks.map((tick) => <span key={tick} className="absolute -translate-x-1/2" style={{ left: `${secondsToPercent(tick)}%` }}>{formatRulerTime(tick)}</span>)}</div>
    <div ref={timelineRef} onClick={(event) => { if (didDragRef.current) { didDragRef.current = false; return; } onSeek(pixelsToSeconds(event.clientX)); }} className="absolute inset-x-0 top-6 bottom-0 bg-secondary/30 border border-secondary/50 cursor-pointer overflow-hidden">
      {ticks.map((tick) => <div key={`grid-${tick}`} className="absolute top-0 bottom-0 border-l border-secondary/40" style={{ left: `${secondsToPercent(tick)}%` }} aria-hidden="true" />)}
      {allScenes.map((scene, index) => {
        const start = getSeconds(scene, 'start_timecode'); const end = getSeconds(scene, 'end_timecode'); if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
        const colors = SCENE_COLORS[index % SCENE_COLORS.length]; const edited = Boolean(editStates[scene.id]); const active = currentTime >= start && currentTime <= end; const width = Math.max(secondsToPercent(end) - secondsToPercent(start), 0.35); const label = `Scene ${scene.scene_number}: ${secondsToTimecode(start)} to ${secondsToTimecode(end)}${edited ? ' (unsaved)' : ''}`;
        return <div key={scene.id} className="absolute top-1 bottom-1 group" style={{ left: `${secondsToPercent(start)}%`, width: `${width}%` }} onMouseEnter={() => setHoveredSceneId(scene.id)} onMouseLeave={() => setHoveredSceneId(null)}>
          <button type="button" title={label} aria-label={label} onClick={(event) => { event.stopPropagation(); onSeek(start); }} className={`absolute inset-0 w-full border ${colors.bg} ${colors.border} ${colors.hover} ${edited ? 'border-dashed' : ''} ${active ? 'ring-2 ring-red-400 ring-inset' : ''} transition-colors`} />
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none text-xs font-semibold text-white drop-shadow-md">{scene.scene_number}</span>
          {(['start', 'end'] as const).map((edge) => <button key={edge} type="button" title={`Adjust scene ${scene.scene_number} ${edge}`} aria-label={`Adjust scene ${scene.scene_number} ${edge} boundary`} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onInitializeEditState(scene); didDragRef.current = false; setDragging({ sceneId: scene.id, edge }); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); adjustBoundary(scene, edge, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : 0.01)); } }} className={`absolute ${edge === 'start' ? 'left-0' : 'right-0'} top-0 z-10 h-full w-2 ${colors.handle} cursor-ew-resize opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white`} />)}
          {hoveredSceneId === scene.id && <span className="absolute left-1/2 bottom-full z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px] text-popover-foreground shadow-md pointer-events-none">{label}</span>}
        </div>;
      })}
    </div>
    <div role="slider" aria-label="Video position" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.max(0, Math.min(currentTime, duration))} tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); onSeek(Math.max(0, Math.min(duration, currentTime + (event.key === 'ArrowRight' ? 1 : -1)))); } }} onPointerDown={(event) => { event.preventDefault(); didDragRef.current = false; setDragging('playhead'); }} className="absolute top-5 bottom-0 z-30 w-8 -translate-x-1/2 cursor-col-resize focus:outline-none focus:ring-2 focus:ring-red-400" style={{ left: `${secondsToPercent(currentTime)}%` }}><div className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-red-500 pointer-events-none" /><div className="absolute left-1/2 top-0 z-40 -translate-x-1/2 -translate-y-px border-l-[8px] border-r-[8px] border-t-[10px] border-l-transparent border-r-transparent border-t-red-500 pointer-events-none" /></div>
  </div>;
};

import React, { useRef, useState } from 'react';
import { Scene } from '@/types/types';
import { timecodeToSeconds, secondsToTimecode, isValidTimecode } from '@/lib/timecode';

interface EditState {
  start_timecode: string;
  end_timecode: string;
}

interface SceneTimelineProps {
  duration: number;
  scenes: Scene[];
  editStates: Record<string, EditState>;
  scenesToDelete: Set<string>;
  onUpdateEditState: (id: string, field: keyof EditState, value: string) => void;
  onInitializeEditState: (scene: Scene) => void;
  currentTime: number;
  onSeek: (seconds: number) => void;
}

const SCENE_COLORS = [
  { bg: 'bg-blue-500/40', border: 'border-blue-600/80', hover: 'hover:bg-blue-500/50', handle: 'bg-blue-600/80 hover:bg-blue-700' },
  { bg: 'bg-emerald-500/40', border: 'border-emerald-600/80', hover: 'hover:bg-emerald-500/50', handle: 'bg-emerald-600/80 hover:bg-emerald-700' },
  { bg: 'bg-purple-500/40', border: 'border-purple-600/80', hover: 'hover:bg-purple-500/50', handle: 'bg-purple-600/80 hover:bg-purple-700' },
  { bg: 'bg-orange-500/40', border: 'border-orange-600/80', hover: 'hover:bg-orange-500/50', handle: 'bg-orange-600/80 hover:bg-orange-700' },
  { bg: 'bg-pink-500/40', border: 'border-pink-600/80', hover: 'hover:bg-pink-500/50', handle: 'bg-pink-600/80 hover:bg-pink-700' },
  { bg: 'bg-cyan-500/40', border: 'border-cyan-600/80', hover: 'hover:bg-cyan-500/50', handle: 'bg-cyan-600/80 hover:bg-cyan-700' },
];

const getSceneColor = (index: number) => SCENE_COLORS[index % SCENE_COLORS.length];

export const SceneTimeline = ({
  duration,
  scenes,
  editStates,
  scenesToDelete,
  onUpdateEditState,
  onInitializeEditState,
  currentTime,
  onSeek,
}: SceneTimelineProps) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [draggingHandle, setDraggingHandle] = useState<{ sceneId: string; edge: 'start' | 'end' } | null>(null);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);

  // Combine saved scenes with unsaved ones from editStates (sorted by start time)
  const allScenes = React.useMemo(() => {
    const result: Scene[] = scenes?.filter((scene) => !scenesToDelete.has(scene.id)) ?? [];

    Object.entries(editStates).forEach(([id, state]) => {
      if (id.startsWith('new-')) {
        result.push({
          id,
          start_timecode: state.start_timecode,
          end_timecode: state.end_timecode,
          scene_number: 0,
          duration_seconds: 0,
          file_id: '',
        } as Scene);
      }
    });

    return result.sort((a, b) => {
      const aStart = timecodeToSeconds(editStates[a.id]?.start_timecode ?? a.start_timecode);
      const bStart = timecodeToSeconds(editStates[b.id]?.start_timecode ?? b.start_timecode);
      if (isNaN(aStart) || isNaN(bStart)) return 0;
      return aStart - bStart;
    }).map((scene, index) => ({ ...scene, scene_number: index + 1 }));
  }, [scenes, editStates, scenesToDelete]);

  // Guard against division by zero
  if (duration <= 0) {
    return (
      <div className="w-full h-12 bg-secondary/30 flex items-center justify-center text-xs text-muted-foreground">
        Loading video...
      </div>
    );
  }

  // Calculate pixel position from seconds
  const secondsToPercent = (seconds: number): number => {
    const clamped = Math.max(0, Math.min(seconds, duration));
    return (clamped / duration) * 100;
  };

  // Calculate seconds from cursor position on timeline
  const pixelsToSeconds = (clientX: number): number => {
    if (!timelineRef.current) return 0;
    const rect = timelineRef.current.getBoundingClientRect();
    const percent = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(percent, 1));
    return clamped * duration;
  };

  // Handle pointer down on a drag handle
  const handlePointerDown = (e: React.PointerEvent, sceneId: string, edge: 'start' | 'end', scene: Scene) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingHandle({ sceneId, edge });
    onInitializeEditState(scene);
  };

  // Handle pointer move for dragging
  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingPlayhead) {
      const newSeconds = pixelsToSeconds(e.clientX);
      onSeek(Math.max(0, Math.min(newSeconds, duration)));
      return;
    }

    if (!draggingHandle) return;

    const rawSeconds = pixelsToSeconds(e.clientX);

    const sceneIndex = allScenes.findIndex((s) => s.id === draggingHandle.sceneId);
    const currentEditState = editStates[draggingHandle.sceneId];

    let clampedSeconds = rawSeconds;

    if (draggingHandle.edge === 'end') {
      // Cannot go below own start
      const ownStart = timecodeToSeconds(currentEditState?.start_timecode ?? allScenes[sceneIndex]?.start_timecode ?? '00:00:00.000');
      // Cannot go past next scene's start
      const nextScene = allScenes[sceneIndex + 1];
      const nextStart = nextScene
        ? timecodeToSeconds(editStates[nextScene.id]?.start_timecode ?? nextScene.start_timecode)
        : duration;
      clampedSeconds = Math.max(ownStart, Math.min(rawSeconds, nextStart));
    } else {
      // Cannot go above own end
      const ownEnd = timecodeToSeconds(currentEditState?.end_timecode ?? allScenes[sceneIndex]?.end_timecode ?? secondsToTimecode(duration));
      // Cannot go before previous scene's end
      const prevScene = allScenes[sceneIndex - 1];
      const prevEnd = prevScene
        ? timecodeToSeconds(editStates[prevScene.id]?.end_timecode ?? prevScene.end_timecode)
        : 0;
      clampedSeconds = Math.min(ownEnd, Math.max(rawSeconds, prevEnd));
    }

    onUpdateEditState(
      draggingHandle.sceneId,
      draggingHandle.edge === 'start' ? 'start_timecode' : 'end_timecode',
      secondsToTimecode(clampedSeconds)
    );
  };

  // Handle pointer up to end dragging
  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingPlayhead) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDraggingPlayhead(false);
      return;
    }

    if (draggingHandle) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDraggingHandle(null);
    }
  };

  // Handle click on empty timeline area to seek
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (draggingHandle) return;
    if (e.target !== timelineRef.current) return;

    const newSeconds = pixelsToSeconds(e.clientX);
    onSeek(newSeconds);
  };

  // Get timecode for a scene, checking editStates first
  const getSceneTimecode = (scene: Scene, field: 'start_timecode' | 'end_timecode'): string => {
    const edited = editStates[scene.id];
    if (edited) {
      const value = edited[field];
      return isValidTimecode(value) ? value : scene[field];
    }
    return scene[field];
  };


  return (
    <div className="relative w-full h-14 overflow-visible">
      <div
        ref={timelineRef}
        onClick={handleTimelineClick}
        className="absolute inset-0 bg-secondary/30 border border-secondary/50 cursor-pointer overflow-hidden flex items-center"
      >
        {/* Scene blocks */}
        {allScenes.map((scene, index) => {
          const startTimecode = getSceneTimecode(scene, 'start_timecode');
          const endTimecode = getSceneTimecode(scene, 'end_timecode');

          const startSeconds = timecodeToSeconds(startTimecode);
          const endSeconds = timecodeToSeconds(endTimecode);

          if (isNaN(startSeconds) || isNaN(endSeconds)) return null;

          const leftPercent = secondsToPercent(startSeconds);
          const widthPercent = secondsToPercent(endSeconds) - leftPercent;

          const colors = getSceneColor(index);

          return (
            <div
              key={scene.id}
            className="absolute h-4/5 top-1/10 flex items-center group"
            style={{
              left: `${leftPercent}%`,
              width: `${widthPercent}%`,
            }}
          >
              {/* Scene block */}
              <div
                onClick={() => onSeek(startSeconds)}
                className={`absolute inset-0 ${colors.bg} border ${colors.border} ${colors.hover} transition-colors`}
              />

              {/* Scene label */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-xs font-semibold text-white drop-shadow-md">{scene.scene_number}</span>
              </div>

              {/* Left handle */}
              <div
                onPointerDown={(e) => handlePointerDown(e, scene.id, 'start', scene)}
                className={`absolute left-0 top-0 h-full w-1 ${colors.handle} cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity`}
                aria-label={`Drag start marker for scene ${scene.scene_number}`}
              />

              {/* Right handle */}
              <div
                onPointerDown={(e) => handlePointerDown(e, scene.id, 'end', scene)}
                className={`absolute right-0 top-0 h-full w-1 ${colors.handle} cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity`}
                aria-label={`Drag end marker for scene ${scene.scene_number}`}
              />
            </div>
          );
        })}
      </div>

      {/* Playhead */}
      <div
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDraggingPlayhead(true);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="absolute top-0 bottom-0 z-30 cursor-col-resize transition-all overflow-visible"
        style={{
          left: `${secondsToPercent(currentTime)}%`,
          transitionDuration: draggingPlayhead ? '0s' : '0.05s',
          transitionTimingFunction: 'linear',
          transform: 'translateX(-50%)',
        }}
      >
        {/* Larger grab area for easier dragging */}
        <div className="absolute left-1/2 top-0 h-full w-8 -translate-x-1/2" />

        {/* Top triangle marker */}
        <div className="absolute left-1/2 top-0 z-40 -translate-x-1/2 -translate-y-[1px] pointer-events-none">
          <div className="w-0 h-0 border-l-[8px] border-r-[8px] border-t-[10px] border-l-transparent border-r-transparent border-t-red-500 drop-shadow-sm" />
        </div>

        {/* Vertical line */}
        <div className="absolute top-0 bottom-0 z-30 w-0.5 bg-red-500 left-1/2 transform -translate-x-1/2 pointer-events-none" />
      </div>
    </div>
  );
};

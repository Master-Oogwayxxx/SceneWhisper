import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { File, Scene } from '@/types/types';
import { sceneApi } from '@/api/scenes';
import { API_BASE } from '@/api/client';
import { timecodeToSeconds, secondsToTimecode, isValidTimecode } from '@/lib/timecode';
import { copyTextToClipboard } from '@/lib/utils';
import { Check, Copy, Crosshair, Loader2, Maximize2, Minimize2, Play, Trash2 } from 'lucide-react';
import { SceneTimeline } from './SceneTimeline';
import { MediaPlayer, MediaProvider, useMediaStore, isVideoProvider, type MediaPlayerInstance, type MediaProviderAdapter, type VideoMimeType } from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';
import { TextTrack } from '@vidstack/react';

const DEFAULT_NEW_SCENE_DURATION_SECONDS = 300;
const DESKTOP_MEDIA_QUERY = '(min-width: 768px)';

const VIDEO_SOURCE_TYPES: Record<string, VideoMimeType> = {
  '.avi': 'video/avi',
  '.3gp': 'video/3gp',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.mp4': 'video/mp4',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.webm': 'video/webm',
};

interface SceneViewerModalProps {
  file: File | null;
  isOpen: boolean;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  return seconds.toFixed(2);
}

function formatPlaybackTime(seconds: number): string {
  return secondsToTimecode(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
}

function getVideoSourceType(file: File): VideoMimeType {
  return VIDEO_SOURCE_TYPES[file.format?.toLowerCase()] ?? 'video/mp4';
}

function shouldUseFullscreenByDefault(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

function copyToClipboard(text: string) {
  return copyTextToClipboard(text).catch((err) => {
    console.error('Failed to copy:', err);
  });
}

function calculateDuration(startTimecode: string, endTimecode: string): number {
  try {
    return timecodeToSeconds(endTimecode) - timecodeToSeconds(startTimecode);
  } catch {
    return 0;
  }
}

function isValidTimeRange(startTimecode: string, endTimecode: string): boolean {
  if (!isValidTimecode(startTimecode) || !isValidTimecode(endTimecode)) {
    return true; // Let format validation handle this
  }
  return timecodeToSeconds(startTimecode) <= timecodeToSeconds(endTimecode);
}

function hasOverlappingScenes(
  scenes: Scene[] | undefined,
  editStates: Record<string, EditState>,
  scenesToDelete: Set<string>
): boolean {
  const intervals: Array<{ start: number; end: number }> = [];

  scenes?.filter(s => !scenesToDelete.has(s.id)).forEach(s => {
    const start = editStates[s.id]?.start_timecode ?? s.start_timecode;
    const end = editStates[s.id]?.end_timecode ?? s.end_timecode;
    if (isValidTimecode(start) && isValidTimecode(end)) {
      intervals.push({ start: timecodeToSeconds(start), end: timecodeToSeconds(end) });
    }
  });

  Object.entries(editStates)
    .filter(([id]) => id.startsWith('new-'))
    .forEach(([, state]) => {
      if (isValidTimecode(state.start_timecode) && isValidTimecode(state.end_timecode)) {
        intervals.push({ start: timecodeToSeconds(state.start_timecode), end: timecodeToSeconds(state.end_timecode) });
      }
    });

  intervals.sort((a, b) => a.start - b.start);
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].start < intervals[i - 1].end) return true;
  }
  return false;
}

interface EditState {
  start_timecode: string;
  end_timecode: string;
}

interface SceneBounds {
  id: string;
  start: number;
  end: number;
}

type DisplayScene =
  | { id: string; number: number; start: number; end: number; kind: 'saved'; scene: Scene }
  | { id: string; number: number; start: number; end: number; kind: 'new'; editState: EditState };

type DisplaySceneDraft =
  | Omit<Extract<DisplayScene, { kind: 'saved' }>, 'number'>
  | Omit<Extract<DisplayScene, { kind: 'new' }>, 'number'>;

export const SceneViewerModal = ({ file, isOpen, onClose }: SceneViewerModalProps) => {
  const queryClient = useQueryClient();
  const [editStates, setEditStates] = useState<Record<string, EditState>>({});
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [scenesToDelete, setScenesToDelete] = useState<Set<string>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<MediaPlayerInstance>(null);
  const seekTimerRef = useRef<number | null>(null);
  const pendingSeekSecondsRef = useRef<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(() => shouldUseFullscreenByDefault());
  const { currentTime, duration: rawVideoDuration } = useMediaStore(playerRef);
  const videoSource = useMemo(() => {
    if (!file) return undefined;

    return {
      src: `${API_BASE}/files/${file.id}/stream`,
      type: getVideoSourceType(file),
    };
  }, [file?.id, file?.format]);

  const { data: scenes, isLoading, isError } = useQuery<Scene[]>({
    queryKey: ['scenes', file?.id],
    queryFn: () => sceneApi.getScenesForFile(file!.id),
    enabled: !!file && isOpen,
    staleTime: 30_000,
  });

  const sceneDuration = Math.max(
    0,
    ...(scenes ?? []).map(s => {
      const endTimecode = editStates[s.id]?.end_timecode ?? s.end_timecode;
      try {
        return isValidTimecode(endTimecode) ? timecodeToSeconds(endTimecode) : 0;
      } catch {
        return 0;
      }
    }),
    ...Object.entries(editStates)
      .filter(([id]) => id.startsWith('new-'))
      .map(([, state]) => {
        try {
          return isValidTimecode(state.end_timecode) ? timecodeToSeconds(state.end_timecode) : 0;
        } catch {
          return 0;
        }
      })
  );
  const videoDuration = Math.max(rawVideoDuration > 0 ? rawVideoDuration : 0, sceneDuration);

  const getDisplayScenes = (
    sourceScenes: Scene[] | undefined = scenes,
    stateOverrides: Record<string, EditState> = editStates,
    deleteOverrides: Set<string> = scenesToDelete
  ): DisplayScene[] => {
    const rows: DisplaySceneDraft[] = [
      ...(sourceScenes?.filter(s => !deleteOverrides.has(s.id)) ?? []).map(scene => {
        const startTimecode = stateOverrides[scene.id]?.start_timecode ?? scene.start_timecode;
        const endTimecode = stateOverrides[scene.id]?.end_timecode ?? scene.end_timecode;

        return {
          id: scene.id,
          start: isValidTimecode(startTimecode) ? timecodeToSeconds(startTimecode) : Number.POSITIVE_INFINITY,
          end: isValidTimecode(endTimecode) ? timecodeToSeconds(endTimecode) : Number.POSITIVE_INFINITY,
          kind: 'saved' as const,
          scene,
        };
      }),
      ...Object.entries(stateOverrides)
        .filter(([id]) => id.startsWith('new-'))
        .map(([id, editState]) => ({
          id,
          start: isValidTimecode(editState.start_timecode) ? timecodeToSeconds(editState.start_timecode) : Number.POSITIVE_INFINITY,
          end: isValidTimecode(editState.end_timecode) ? timecodeToSeconds(editState.end_timecode) : Number.POSITIVE_INFINITY,
          kind: 'new' as const,
          editState,
        })),
    ];

    return rows
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .map((row, index) => ({ ...row, number: index + 1 }));
  };

  const updateMutation = useMutation({
    mutationFn: async (data: { updates: Array<{ id: string; start: string; end: string }>; creates: Array<{ start: string; end: string }>; deletes: string[] }) => {
      const updatePromises = data.updates.map(({ id, start, end }) => sceneApi.updateScene(id, start, end, false));
      const createPromises = data.creates.map(({ start, end }) => sceneApi.createScene(file!.id, start, end));
      const deletePromises = data.deletes.map(id => sceneApi.deleteScene(id));
      return Promise.all([...updatePromises, ...createPromises, ...deletePromises]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenes', file?.id] });
      setEditStates({});
      setScenesToDelete(new Set());
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (sceneId: string) => sceneApi.deleteScene(sceneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenes', file?.id] });
      setDeleteConfirmation(null);
    },
    onError: () => {
      setDeleteConfirmation(null);
    },
  });

  const handleProviderSetup = (provider: MediaProviderAdapter) => {
    if (isVideoProvider(provider)) {
      (videoRef as React.MutableRefObject<HTMLVideoElement>).current = provider.video;
    }
  };

  const seekToSeconds = useCallback((seconds: number) => {
    const targetSeconds = Math.max(0, Math.min(seconds, videoDuration || seconds));
    pendingSeekSecondsRef.current = targetSeconds;

    if (seekTimerRef.current !== null) {
      window.clearTimeout(seekTimerRef.current);
    }

    seekTimerRef.current = window.setTimeout(() => {
      seekTimerRef.current = null;
      const nextSeconds = pendingSeekSecondsRef.current;
      pendingSeekSecondsRef.current = null;
      if (nextSeconds === null) return;

      const player = playerRef.current;
      if (player) {
        player.remoteControl.seek(nextSeconds);
        return;
      }

      if (videoRef.current) {
        videoRef.current.currentTime = nextSeconds;
      }
    }, 125);
  }, [videoDuration]);

  const handleSeekToTimecode = (timecode: string) => {
    if (!isValidTimecode(timecode)) return;
    seekToSeconds(timecodeToSeconds(timecode));
  };

  useEffect(() => {
    if (isOpen) {
      setIsFullscreen(shouldUseFullscreenByDefault());
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (seekTimerRef.current !== null) {
        window.clearTimeout(seekTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    // Build effective list: saved scenes + new scenes - deleted scenes
    const effectiveScenes = getDisplayScenes().map(row => ({
      id: row.id,
      number: row.number,
      start: row.kind === 'saved' ? editStates[row.id]?.start_timecode ?? row.scene.start_timecode : row.editState.start_timecode,
      end: row.kind === 'saved' ? editStates[row.id]?.end_timecode ?? row.scene.end_timecode : row.editState.end_timecode,
    }));

    if (effectiveScenes.length === 0) return;

    const track = new TextTrack({ kind: 'chapters', label: 'Scenes', default: true });
    effectiveScenes.forEach(s => {
      try {
        const startSec = timecodeToSeconds(s.start);
        const endSec = timecodeToSeconds(s.end);
        if (!isNaN(startSec) && !isNaN(endSec)) {
          track.addCue(new VTTCue(startSec, endSec, `Scene ${s.number}`));
        }
      } catch {
        // skip cue for malformed timecode
      }
    });

    player.textTracks.add(track);
    return () => { player.textTracks.remove(track); };
  }, [scenes, editStates, scenesToDelete]);

  const handleAddScene = () => {
    if (videoDuration <= 0) return;

    const startSeconds = getSceneInsertionStartSeconds();
    const endSeconds = Math.min(startSeconds + DEFAULT_NEW_SCENE_DURATION_SECONDS, videoDuration);

    // No room — shrink the last scene to fit the new one
    if (startSeconds >= videoDuration || endSeconds <= startSeconds) {
      const lastScene = (() => {
        // Check new unsaved scenes first
        const newEntries = Object.entries(editStates)
          .filter(([id]) => id.startsWith('new-'))
          .sort(([a], [b]) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
        if (newEntries.length > 0) {
          const [id, state] = newEntries[newEntries.length - 1];
          return { id, start: timecodeToSeconds(state.start_timecode), end: timecodeToSeconds(state.end_timecode), isNew: true };
        }
        // Fall back to saved scenes
        const saved = scenes
          ?.filter(s => !scenesToDelete.has(s.id))
          .map(s => ({
            id: s.id,
            start: timecodeToSeconds(editStates[s.id]?.start_timecode ?? s.start_timecode),
            end: timecodeToSeconds(editStates[s.id]?.end_timecode ?? s.end_timecode),
            isNew: false,
          }))
          .sort((a, b) => b.end - a.end);
        return saved?.[0] ?? null;
      })();

      if (!lastScene) return;

      const available = lastScene.end - lastScene.start;
      if (available <= 1) return; // Not enough room to split

      const newDuration = Math.min(DEFAULT_NEW_SCENE_DURATION_SECONDS, Math.floor(available / 2));
      const newStart = lastScene.end - newDuration;

      // Shrink last scene
      if (lastScene.isNew) {
        setEditStates(prev => ({
          ...prev,
          [lastScene.id]: {
            start_timecode: secondsToTimecode(lastScene.start),
            end_timecode: secondsToTimecode(newStart),
          },
        }));
      } else {
        const savedScene = scenes?.find(s => s.id === lastScene.id);
        if (savedScene) {
          setEditStates(prev => ({
            ...prev,
            [lastScene.id]: {
              start_timecode: editStates[lastScene.id]?.start_timecode ?? savedScene.start_timecode,
              end_timecode: secondsToTimecode(newStart),
            },
          }));
        }
      }

      const newSceneId = `new-${Date.now()}`;
      setEditStates(prev => ({
        ...prev,
        [newSceneId]: {
          start_timecode: secondsToTimecode(newStart),
          end_timecode: secondsToTimecode(lastScene.end),
        },
      }));
      return;
    }

    const startTimecode = secondsToTimecode(startSeconds);
    const endTimecode = secondsToTimecode(endSeconds);

    const newSceneId = `new-${Date.now()}`;
    setEditStates(prev => ({
      ...prev,
      [newSceneId]: { start_timecode: startTimecode, end_timecode: endTimecode }
    }));
  };

  const initializeEditState = (scene: Scene) => {
    if (!editStates[scene.id]) {
      setEditStates(prev => ({
        ...prev,
        [scene.id]: { start_timecode: scene.start_timecode, end_timecode: scene.end_timecode }
      }));
    }
  };

  const updateEditState = (sceneId: string, field: keyof EditState, value: string) => {
    setEditStates(prev => ({
      ...prev,
      [sceneId]: { ...prev[sceneId], [field]: value }
    }));
  };

  const saveAllEdits = () => {
    const updates: Array<{ id: string; start: string; end: string }> = [];
    const creates: Array<{ start: string; end: string }> = [];
    const deletes = Array.from(scenesToDelete);

    Object.entries(editStates).forEach(([id, state]) => {
      if (isValidTimecode(state.start_timecode) && isValidTimecode(state.end_timecode)) {
        if (id.startsWith('new-')) {
          creates.push({ start: state.start_timecode, end: state.end_timecode });
        } else {
          updates.push({ id, start: state.start_timecode, end: state.end_timecode });
        }
      }
    });

    if ((updates.length > 0 || creates.length > 0 || deletes.length > 0) && (updates.length + creates.length) === Object.keys(editStates).length) {
      updateMutation.mutate({ updates, creates, deletes });
    }
  };

  const resetAll = () => {
    setEditStates({});
    setDeleteConfirmation(null);
    setScenesToDelete(new Set());
    setIsFullscreen(shouldUseFullscreenByDefault());
  };

  const handleCopy = (text: string, fieldId: string) => {
    copyToClipboard(text).then(() => {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const confirmDelete = () => {
    if (deleteConfirmation) {
      deleteMutation.mutate(deleteConfirmation);
    }
  };

  const cancelDelete = () => {
    setDeleteConfirmation(null);
  };

  const getCurrentSceneBounds = (sceneId: string, stateOverrides: Record<string, EditState> = editStates): SceneBounds | null => {
    const savedScene = scenes?.find(scene => scene.id === sceneId);
    const state = stateOverrides[sceneId];

    if (!savedScene && !state) return null;

    const startTimecode = state?.start_timecode ?? savedScene?.start_timecode;
    const endTimecode = state?.end_timecode ?? savedScene?.end_timecode;

    if (!startTimecode || !endTimecode || !isValidTimecode(startTimecode) || !isValidTimecode(endTimecode)) {
      return null;
    }

    return {
      id: sceneId,
      start: timecodeToSeconds(startTimecode),
      end: timecodeToSeconds(endTimecode),
    };
  };

  const extendPrecedingSceneIntoDeletedRange = (
    sceneId: string,
    nextScenesToDelete: Set<string>,
    stateOverrides: Record<string, EditState> = editStates
  ): Record<string, EditState> => {
    const deletedScene = getCurrentSceneBounds(sceneId, stateOverrides);
    if (!deletedScene) return stateOverrides;

    const sceneBounds: SceneBounds[] = [
      ...(scenes ?? []).map(scene => {
        const state = stateOverrides[scene.id];
        const startTimecode = state?.start_timecode ?? scene.start_timecode;
        const endTimecode = state?.end_timecode ?? scene.end_timecode;

        if (!isValidTimecode(startTimecode) || !isValidTimecode(endTimecode)) {
          return null;
        }

        return {
          id: scene.id,
          start: timecodeToSeconds(startTimecode),
          end: timecodeToSeconds(endTimecode),
        };
      }),
      ...Object.entries(stateOverrides)
        .filter(([id]) => id.startsWith('new-'))
        .map(([id, state]) => {
          if (!isValidTimecode(state.start_timecode) || !isValidTimecode(state.end_timecode)) {
            return null;
          }

          return {
            id,
            start: timecodeToSeconds(state.start_timecode),
            end: timecodeToSeconds(state.end_timecode),
          };
        }),
    ].filter((scene): scene is SceneBounds => scene !== null)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const deletedIndex = sceneBounds.findIndex(scene => scene.id === sceneId);
    if (deletedIndex <= 0) return stateOverrides;

    const precedingScene = sceneBounds
      .slice(0, deletedIndex)
      .reverse()
      .find(scene => !nextScenesToDelete.has(scene.id));

    if (!precedingScene) return stateOverrides;

    const nextEnd = Math.max(precedingScene.end, deletedScene.end);
    const savedPrecedingScene = scenes?.find(scene => scene.id === precedingScene.id);

    return {
      ...stateOverrides,
      [precedingScene.id]: {
        start_timecode: stateOverrides[precedingScene.id]?.start_timecode ?? savedPrecedingScene?.start_timecode ?? secondsToTimecode(precedingScene.start),
        end_timecode: secondsToTimecode(nextEnd),
      },
    };
  };

  const handleToggleSceneDeletion = (sceneId: string) => {
    const next = new Set(scenesToDelete);
    if (next.has(sceneId)) {
      next.delete(sceneId);
      setScenesToDelete(next);
      return;
    }

    next.add(sceneId);
    setScenesToDelete(next);
    setEditStates(current => extendPrecedingSceneIntoDeletedRange(sceneId, next, current));
  };

  const handleDeleteNewScene = (sceneId: string) => {
    setEditStates(prev => {
      const expandedState = extendPrecedingSceneIntoDeletedRange(sceneId, scenesToDelete, prev);
      const nextState = { ...expandedState };
      delete nextState[sceneId];
      return nextState;
    });
  };

  const getSceneInsertionStartSeconds = () => {
    const playheadSeconds = Math.max(0, currentTime);

    const effectiveScenes = [
      ...(scenes?.filter(s => !scenesToDelete.has(s.id)) ?? []).map(s => ({
        start: timecodeToSeconds(editStates[s.id]?.start_timecode ?? s.start_timecode),
        end: timecodeToSeconds(editStates[s.id]?.end_timecode ?? s.end_timecode),
      })),
      ...Object.entries(editStates)
        .filter(([id]) => id.startsWith('new-'))
        .map(([, state]) => ({
          start: timecodeToSeconds(state.start_timecode),
          end: timecodeToSeconds(state.end_timecode),
        })),
    ]
      .filter(scene => Number.isFinite(scene.start) && Number.isFinite(scene.end))
      .sort((a, b) => a.start - b.start);

    let candidateStart = playheadSeconds;
    for (const scene of effectiveScenes) {
      if (candidateStart + DEFAULT_NEW_SCENE_DURATION_SECONDS <= scene.start) {
        return candidateStart;
      }

      if (candidateStart < scene.end) {
        candidateStart = scene.end + 1;
      }
    }

    if (candidateStart + DEFAULT_NEW_SCENE_DURATION_SECONDS <= videoDuration) {
      return candidateStart;
    }

    const lastEndTimecode = getLatestEndTimecode();
    if (!lastEndTimecode) return playheadSeconds;

    const lastEndSeconds = timecodeToSeconds(lastEndTimecode);
    return Math.min(lastEndSeconds + 1, videoDuration);
  };

  const getLatestEndTimecode = (): string | null => {
    // New unsaved scenes take precedence
    const newSceneEntries = Object.entries(editStates)
      .filter(([id]) => id.startsWith('new-'))
      .sort(([a], [b]) => parseInt(a.slice(4)) - parseInt(b.slice(4)));

    if (newSceneEntries.length > 0) {
      const [, lastNewScene] = newSceneEntries[newSceneEntries.length - 1];

      if (isValidTimecode(lastNewScene.end_timecode)) {
        return lastNewScene.end_timecode;
      }
    }

    // Build current scene state using local edits
    const currentScenes =
      scenes
        ?.filter(scene => !scenesToDelete.has(scene.id))
        .map(scene => ({
          ...scene,
          end_timecode:
            editStates[scene.id]?.end_timecode ?? scene.end_timecode,
        }))
        .filter(scene => isValidTimecode(scene.end_timecode))
        .sort(
          (a, b) =>
            timecodeToSeconds(a.end_timecode) -
            timecodeToSeconds(b.end_timecode)
        ) ?? [];

    return currentScenes.length > 0
      ? currentScenes[currentScenes.length - 1].end_timecode
      : null;
  };

  const renderDisplaySceneRow = (displayScene: DisplayScene) => {
    if (displayScene.kind === 'new') {
      const { id, editState } = displayScene;
      const startInvalid = editState.start_timecode && !isValidTimecode(editState.start_timecode);
      const endInvalid = editState.end_timecode && !isValidTimecode(editState.end_timecode);
      const rangeInvalid = isValidTimecode(editState.start_timecode) && isValidTimecode(editState.end_timecode) && !isValidTimeRange(editState.start_timecode, editState.end_timecode);

      return (
        <div key={id} className="space-y-1">
          <div className="grid grid-cols-[2rem_minmax(7rem,1fr)_2rem_2rem_2rem_minmax(7rem,1fr)_2rem_2rem_2rem_1fr_3rem] gap-2 px-2 py-1.5 text-sm rounded transition-colors items-center bg-primary/10">
            <span className="text-muted-foreground font-semibold">{displayScene.number}</span>
            <Input
              className="w-full min-w-0 h-6 text-sm font-mono px-1"
              value={editState.start_timecode}
              onChange={(e) => updateEditState(id, 'start_timecode', e.target.value)}
              onBlur={(e) => {
                if (e.target.value && !isValidTimecode(e.target.value)) {
                  e.target.classList.add('border-destructive');
                } else {
                  e.target.classList.remove('border-destructive');
                }
              }}
              placeholder="00:00:00.000"
              pattern="\d{2}:\d{2}:\d{2}\.\d{3}"
            />
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleSeekToTimecode(editState.start_timecode)} aria-label="Go to start timestamp">
              <Play className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => {
                const t = videoRef.current?.currentTime;
                if (t !== undefined) {
                  updateEditState(id, 'start_timecode', secondsToTimecode(t));
                }
              }}
              aria-label="Set start to current time"
            >
              <Crosshair className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleCopy(editState.start_timecode, `start-${id}`)} aria-label="Copy start timestamp">
              {copiedField === `start-${id}` ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
            </Button>
            <Input
              className="w-full min-w-0 h-6 text-sm font-mono px-1"
              value={editState.end_timecode}
              onChange={(e) => updateEditState(id, 'end_timecode', e.target.value)}
              onBlur={(e) => {
                if (e.target.value && !isValidTimecode(e.target.value)) {
                  e.target.classList.add('border-destructive');
                } else {
                  e.target.classList.remove('border-destructive');
                }
              }}
              placeholder="00:00:00.000"
              pattern="\d{2}:\d{2}:\d{2}\.\d{3}"
            />
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleSeekToTimecode(editState.end_timecode)} aria-label="Go to end timestamp">
              <Play className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => {
                const t = videoRef.current?.currentTime;
                if (t !== undefined) {
                  updateEditState(id, 'end_timecode', secondsToTimecode(t));
                }
              }}
              aria-label="Set end to current time"
            >
              <Crosshair className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleCopy(editState.end_timecode, `end-${id}`)} aria-label="Copy end timestamp">
              {copiedField === `end-${id}` ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
            </Button>
            <span className="text-muted-foreground text-sm">
              {isValidTimecode(editState.start_timecode) && isValidTimecode(editState.end_timecode)
                ? formatDuration(calculateDuration(editState.start_timecode, editState.end_timecode))
                : '-'}
            </span>
            <div className="flex gap-0.5">
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleDeleteNewScene(id)} aria-label="Delete new scene">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {(startInvalid || endInvalid || rangeInvalid) && (
            <div className="px-2 text-xs text-destructive space-y-0.5">
              {startInvalid && <div>Start: Invalid format (use HH:MM:SS.mmm)</div>}
              {endInvalid && <div>End: Invalid format (use HH:MM:SS.mmm)</div>}
              {rangeInvalid && <div>End time must be after start time</div>}
            </div>
          )}
        </div>
      );
    }

    const scene = displayScene.scene;
    const isModified = scene.id in editStates;
    const currentEdit = editStates[scene.id];
    const startInvalid = currentEdit?.start_timecode && !isValidTimecode(currentEdit.start_timecode);
    const endInvalid = currentEdit?.end_timecode && !isValidTimecode(currentEdit.end_timecode);
    const rangeInvalid = currentEdit && isValidTimecode(currentEdit.start_timecode) && isValidTimecode(currentEdit.end_timecode) && !isValidTimeRange(currentEdit.start_timecode, currentEdit.end_timecode);

    return (
      <div key={scene.id} className="space-y-1">
        <div className={`grid grid-cols-[2rem_minmax(7rem,1fr)_2rem_2rem_2rem_minmax(7rem,1fr)_2rem_2rem_2rem_1fr_3rem] gap-2 px-2 py-1.5 text-sm rounded transition-colors items-center ${isModified ? 'bg-primary/5' : 'hover:bg-secondary/50'}`}>
          <span className="text-muted-foreground">{displayScene.number}</span>
          <Input
            className="w-full min-w-0 h-6 text-sm font-mono px-1"
            value={currentEdit?.start_timecode ?? scene.start_timecode}
            onChange={(e) => {
              initializeEditState(scene);
              updateEditState(scene.id, 'start_timecode', e.target.value);
            }}
            onBlur={(e) => {
              if (e.target.value && !isValidTimecode(e.target.value)) {
                e.target.classList.add('border-destructive');
              } else {
                e.target.classList.remove('border-destructive');
              }
            }}
            placeholder="00:00:00.000"
            pattern="\d{2}:\d{2}:\d{2}\.\d{3}"
          />
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleSeekToTimecode(currentEdit?.start_timecode ?? scene.start_timecode)} aria-label="Go to start timestamp">
            <Play className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => {
              const t = videoRef.current?.currentTime;
              if (t !== undefined) {
                if (!editStates[scene.id]) initializeEditState(scene);
                updateEditState(scene.id, 'start_timecode', secondsToTimecode(t));
              }
            }}
            aria-label="Set start to current time"
          >
            <Crosshair className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleCopy(currentEdit?.start_timecode ?? scene.start_timecode, `start-${scene.id}`)} aria-label="Copy start timestamp">
            {copiedField === `start-${scene.id}` ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
          </Button>
          <Input
            className="w-full min-w-0 h-6 text-sm font-mono px-1"
            value={currentEdit?.end_timecode ?? scene.end_timecode}
            onChange={(e) => {
              initializeEditState(scene);
              updateEditState(scene.id, 'end_timecode', e.target.value);
            }}
            onBlur={(e) => {
              if (e.target.value && !isValidTimecode(e.target.value)) {
                e.target.classList.add('border-destructive');
              } else {
                e.target.classList.remove('border-destructive');
              }
            }}
            placeholder="00:00:00.000"
            pattern="\d{2}:\d{2}:\d{2}\.\d{3}"
          />
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleSeekToTimecode(currentEdit?.end_timecode ?? scene.end_timecode)} aria-label="Go to end timestamp">
            <Play className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => {
              const t = videoRef.current?.currentTime;
              if (t !== undefined) {
                if (!editStates[scene.id]) initializeEditState(scene);
                updateEditState(scene.id, 'end_timecode', secondsToTimecode(t));
              }
            }}
            aria-label="Set end to current time"
          >
            <Crosshair className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => handleCopy(currentEdit?.end_timecode ?? scene.end_timecode, `end-${scene.id}`)} aria-label="Copy end timestamp">
            {copiedField === `end-${scene.id}` ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
          </Button>
          <span className="text-muted-foreground text-sm">
            {isModified && currentEdit && isValidTimecode(currentEdit.start_timecode) && isValidTimecode(currentEdit.end_timecode)
              ? formatDuration(calculateDuration(currentEdit.start_timecode, currentEdit.end_timecode))
              : formatDuration(scene.duration_seconds)}
          </span>
          <div className="flex gap-0.5">
            <Button variant="ghost" size="icon" className={`h-5 w-5 ${scenesToDelete.has(scene.id) ? 'text-destructive' : ''}`} onClick={() => handleToggleSceneDeletion(scene.id)} aria-label="Mark scene for deletion">
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
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
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        resetAll();
        onClose();
      }
    }}>
      <DialogContent aria-describedby={undefined} className={isFullscreen
        ? "!h-[100dvh] !max-h-[100dvh] !w-screen !max-w-none rounded-none sm:!rounded-none flex flex-col"
        : "max-w-3xl min-h-[95vh] max-h-[95vh] flex flex-col"
      }>
        <DialogHeader className="flex flex-row items-center justify-between pr-8 shrink-0">
          <DialogTitle>Scenes — {file?.name}</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setIsFullscreen(prev => !prev)}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </DialogHeader>

        <div className="flex flex-col flex-1 min-h-0 gap-4 overflow-hidden">
          <div className={isFullscreen
            ? "flex gap-4 flex-1 min-h-0 overflow-hidden"
            : "flex flex-col gap-4 flex-1 min-h-0 overflow-hidden"
          }>
            {file && (
              <div className={`${isFullscreen ? 'w-3/5' : 'w-full max-w-2xl mx-auto'} shrink-0 bg-black rounded-md overflow-hidden aspect-video relative ${isFullscreen ? 'flex items-center self-center' : 'self-start'}`}>
                <MediaPlayer
                  ref={playerRef}
                  src={videoSource}
                  className="w-full h-full"
                  load="eager"
                  onProviderSetup={handleProviderSetup}
                >
                  <MediaProvider />
                  <DefaultVideoLayout icons={defaultLayoutIcons} seekStep={5} />
                </MediaPlayer>
              </div>
            )}

            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar">
              {isLoading && (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading scenes...
                </div>
              )}

              {isError && (
                <p className="text-destructive text-sm py-4">Failed to load scenes.</p>
              )}

              {scenes && scenes.length === 0 && !Object.keys(editStates).some(id => id.startsWith('new-')) && (
                <p className="text-muted-foreground text-sm py-4">No scenes detected for this file.</p>
              )}

              {(scenes && scenes.length > 0) || Object.keys(editStates).some(id => id.startsWith('new-')) ? (
                <div className="space-y-1 flex-1 overflow-y-auto scrollbar">
                  <div className="grid grid-cols-[2rem_minmax(7rem,1fr)_2rem_2rem_2rem_minmax(7rem,1fr)_2rem_2rem_2rem_1fr_3rem] gap-2 px-2 py-1 text-xs font-medium text-muted-foreground border-b">
                    <span>#</span>
                    <span>Start</span>
                    <span />
                    <span />
                    <span />
                    <span>End</span>
                    <span />
                    <span />
                    <span />
                    <span>Duration (secs)</span>
                    <span />
                  </div>
                  {getDisplayScenes().map(renderDisplaySceneRow)}
                </div>
              ) : null}

              {hasOverlappingScenes(scenes, editStates, scenesToDelete) && (
                <p className="text-xs text-destructive mt-2">Scenes have overlapping timecodes. Fix overlaps before saving.</p>
              )}

              <div className="flex gap-2 justify-between mt-4 pt-4 border-t">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={resetAll}
                    disabled={updateMutation.isPending || (Object.keys(editStates).length === 0 && scenesToDelete.size === 0)}
                  >
                    Reset All
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleAddScene}
                    disabled={!file}
                  >
                    Add Scene
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      resetAll();
                      onClose();
                    }}
                    disabled={updateMutation.isPending || deleteMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={saveAllEdits}
                    disabled={
                      updateMutation.isPending ||
                      (Object.keys(editStates).length === 0 && scenesToDelete.size === 0) ||
                      !Object.values(editStates).every(state => isValidTimecode(state.start_timecode) && isValidTimecode(state.end_timecode) && isValidTimeRange(state.start_timecode, state.end_timecode)) ||
                      hasOverlappingScenes(scenes, editStates, scenesToDelete)
                    }
                  >
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {scenes && videoDuration > 0 && (
            <div className="shrink-0 pt-4 border-t">
              <div className="flex justify-end pb-2 text-xs font-mono text-muted-foreground">
                {formatPlaybackTime(currentTime)} / {formatPlaybackTime(videoDuration)}
              </div>
              <SceneTimeline
                duration={videoDuration}
                scenes={scenes}
                editStates={editStates}
                scenesToDelete={scenesToDelete}
                onUpdateEditState={updateEditState}
                onInitializeEditState={initializeEditState}
                currentTime={currentTime}
                onSeek={seekToSeconds}
              />
            </div>
          )}
        </div>

        <AlertDialog open={deleteConfirmation !== null} onOpenChange={(open) => !open && cancelDelete()}>
          <AlertDialogContent>
            <AlertDialogTitle>Delete Scene?</AlertDialogTitle>
            {deleteConfirmation && scenes && (
              <AlertDialogDescription>
                {(() => {
                  const scene = scenes.find(s => s.id === deleteConfirmation);
                  const displayScene = getDisplayScenes().find(row => row.id === deleteConfirmation);
                  return scene ? `Scene ${displayScene?.number ?? scene.scene_number} (${scene.start_timecode} → ${scene.end_timecode})` : '';
                })()}
              </AlertDialogDescription>
            )}
            <div className="flex gap-2 justify-end mt-4">
              <AlertDialogCancel onClick={cancelDelete}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => confirmDelete()}
                disabled={deleteMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Delete
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
};

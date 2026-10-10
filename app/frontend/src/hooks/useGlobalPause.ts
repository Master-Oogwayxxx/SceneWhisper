import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { taskApi } from '../api/tasks';
import { useSettings } from './useSettings';

export function useGlobalPause() {
  const { settings } = useSettings();
  const queryClient = useQueryClient();

  // Poll global pause status at task_poll_interval_ms
  const { data, isLoading } = useQuery({
    queryKey: ['globalPauseStatus'],
    queryFn: () => taskApi.getGlobalPauseStatus(),
    refetchInterval: settings?.task_poll_interval_ms || 5000,
  });

  // Mutation for pause all
  const { mutate: globalPause } = useMutation({
    mutationFn: () => taskApi.globalPause(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalPauseStatus'] });
    },
    onError: () => {
      toast.error('Failed to pause all tasks');
    },
  });

  // Mutation for unpause all
  const { mutate: globalUnpause } = useMutation({
    mutationFn: () => taskApi.globalUnpause(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalPauseStatus'] });
    },
    onError: () => {
      toast.error('Failed to resume all tasks');
    },
  });

  return {
    isGloballyPaused: data?.is_globally_paused ?? false,
    globalPause,
    globalUnpause,
    isLoading,
  };
}

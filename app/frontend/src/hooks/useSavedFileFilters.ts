import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fileFiltersApi } from '@/api/fileFilters'
import { FileFilterState, SavedFileFilter } from '@/lib/file-filters'

const FILE_FILTERS_KEY = ['file-filters'] as const

/**
 * CRUD hook for server-persisted file filter presets.
 * @returns Query state and mutation helpers for saved filters
 */
export function useSavedFileFilters() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: FILE_FILTERS_KEY,
    queryFn: fileFiltersApi.list,
    staleTime: 30_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: FILE_FILTERS_KEY })

  const createMutation = useMutation({
    mutationFn: ({ name, filters }: { name: string; filters: FileFilterState }) =>
      fileFiltersApi.create(name, filters),
    onSuccess: invalidate,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: { name?: string; filters?: FileFilterState; isDefault?: boolean } }) =>
      fileFiltersApi.update(id, updates),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fileFiltersApi.remove(id),
    onSuccess: invalidate,
  })

  return {
    presets: query.data ?? ([] as SavedFileFilter[]),
    isLoading: query.isLoading,
    isError: query.isError,
    createPreset: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    updatePreset: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    deletePreset: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  }
}

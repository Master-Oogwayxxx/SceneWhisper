import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { fileApi } from '@/api/files';
import { File } from '@/types/types';
import { toast } from 'sonner';

interface SubtitleEditorModalProps {
  file: File | null;
  isOpen: boolean;
  onClose: () => void;
}

export const SubtitleEditorModal = ({ file, isOpen, onClose }: SubtitleEditorModalProps) => {
  const [content, setContent] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['subtitle-content', file?.id],
    queryFn: () => fileApi.getFileContent(file!.id),
    enabled: isOpen && !!file,
  });

  useEffect(() => {
    if (data) setContent(data.content);
  }, [data]);

  useEffect(() => {
    if (!isOpen) setContent('');
  }, [isOpen]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => fileApi.saveFileContent(file!.id, content),
    onSuccess: () => {
      toast.success('Subtitle saved');
      onClose();
    },
    onError: () => {
      toast.error('Failed to save subtitle');
    },
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[95vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Subtitle</DialogTitle>
          <DialogDescription className="truncate">{file?.path}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive p-2">Failed to load subtitle content.</p>
          ) : (
            <textarea
              className="w-full h-[50vh] resize-none rounded-md border border-input bg-background p-3 font-mono text-sm focus:outline-none"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={() => save()} disabled={isLoading || isError || isPending}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Film, Scissors, FileText, Loader2, AlertCircle, Layers } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { fileApi } from '@/api/files';
import { File } from '@/types/types';

interface ViewResultsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File;
}

interface FileRowProps {
  file: File;
  highlight?: boolean;
}

function FileRow({ file, highlight }: FileRowProps) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm space-y-0.5 ${highlight
        ? 'border-primary/40 bg-primary/5'
        : 'border-border bg-muted/30'
        }`}
    >
      <p className="font-medium truncate" title={file.name}>
        {file.name}
      </p>
      <p className="text-xs text-muted-foreground truncate" title={file.path}>
        {file.path}
      </p>
    </div>
  );
}

interface SectionProps {
  icon: ReactNode;
  label: string;
  files: File[];
  originId: string;
}

function Section({ icon, label, files, originId }: SectionProps) {
  if (files.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
        <Badge variant="secondary" className="text-xs px-1.5 py-0">
          {files.length}
        </Badge>
      </div>
      <div className="space-y-1.5 pl-6">
        {files.map((f) => (
          <FileRow key={f.id} file={f} highlight={f.id === originId} />
        ))}
      </div>
    </div>
  );
}

export function ViewResultsDialog({ open, onOpenChange, file }: ViewResultsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultFiles, setGroupFiles] = useState<File[]>([]);

  useEffect(() => {
    if (!open) return;

    let ignore = false;
    setLoading(true);
    setError(null);
    setGroupFiles([]);

    fileApi
      .getFileWithChildren(file.id)
      .then((res) => {
        if (ignore) return;
        setGroupFiles(res.files);
      })
      .catch(() => {
        if (ignore) return;
        setError('Failed to load results. Please try again.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => { ignore = true; };
  }, [open, file.id]);

  const videoOrigins = resultFiles.filter((f) => f.file_type === 'video' && !f.parent_id);
  const splitVideos = resultFiles.filter((f) => f.file_type === 'video' && !!f.parent_id);
  const subtitles = resultFiles.filter((f) => f.file_type === 'subtitle');

  const hasRelated = resultFiles.length > 1 || (resultFiles.length === 1 && resultFiles[0].id !== file.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            View Results
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading results…</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-3 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && !hasRelated && (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No results found.
          </p>
        )}

        {!loading && !error && hasRelated && (
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-5 py-1">
              <Section
                icon={<Film className="w-4 h-4 text-muted-foreground shrink-0" />}
                label="Video Origin"
                files={videoOrigins}
                originId={file.id}
              />
              <div className="grid grid-cols-2 gap-4">
                <Section
                  icon={<Scissors className="w-4 h-4 text-muted-foreground shrink-0" />}
                  label="Split Videos"
                  files={splitVideos}
                  originId={file.id}
                />
                <Section
                  icon={<FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
                  label="Generated Subtitles"
                  files={subtitles}
                  originId={file.id}
                />
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

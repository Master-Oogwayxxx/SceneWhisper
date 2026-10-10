import { FileText, HardDrive, Clock, Film, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatFileSize } from '@/lib/utils';
import { File } from '@/types/types';

interface FileInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File;
}

interface MetaRowProps {
  label: string;
  value: string | number | undefined | null;
}

function MetaRow({ label, value }: MetaRowProps) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{String(value)}</dd>
    </>
  );
}

export function FileInfoDialog({ open, onOpenChange, file }: FileInfoDialogProps) {
  const createdAt = file.created_at
    ? new Date(file.created_at as unknown as string).toLocaleString()
    : undefined;
  const modifiedAt = file.modified_at
    ? new Date(file.modified_at as unknown as string).toLocaleString()
    : undefined;
  const lastScannedAt = file.last_scanned_at
    ? new Date(file.last_scanned_at as unknown as string).toLocaleString()
    : undefined;

  const dimensions =
    file.width != null && file.height != null
      ? `${file.width} × ${file.height}`
      : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="w-5 h-5 text-primary" />
            File Info
          </DialogTitle>
          <DialogDescription>{file.name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Identity */}
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">Identity</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 pl-6">
            <MetaRow label="Name" value={file.name} />
            <MetaRow label="Path" value={file.path} />
            <MetaRow label="File type" value={file.file_type} />
            <MetaRow label="Format" value={file.format} />
          </dl>

          {/* Storage */}
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium">Storage</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 pl-6">
            <MetaRow label="Size" value={formatFileSize(file.size)} />
          </dl>

          {/* Timestamps */}
          {(createdAt || modifiedAt || lastScannedAt) && (
            <>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">Timestamps</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 pl-6">
                <MetaRow label="Created" value={createdAt} />
                <MetaRow label="Modified" value={modifiedAt} />
                <MetaRow label="Last scanned" value={lastScannedAt} />
              </dl>
            </>
          )}

          {/* Media */}
          {(file.duration || dimensions || file.fps != null || file.codec || file.bitrate != null) && (
            <>
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">Media</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 pl-6">
                <MetaRow label="Duration" value={file.duration} />
                <MetaRow label="Resolution" value={dimensions} />
                <MetaRow label="FPS" value={file.fps} />
                <MetaRow label="Codec" value={file.codec} />
                <MetaRow label="Bitrate" value={file.bitrate != null ? `${(file.bitrate / 1000).toFixed(0)} kbps` : undefined} />
              </dl>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

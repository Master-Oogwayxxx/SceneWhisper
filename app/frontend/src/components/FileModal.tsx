import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Directory, File } from '@/types/types';

interface FileModalProps {
  file: File | Directory | null;
  isOpen: boolean;
  onClose: () => void;
}

export const FileModal = ({ file, isOpen, onClose }: FileModalProps) => {
  if (!file) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>File Information</DialogTitle>
          </div>
        </DialogHeader>
        <div className="py-4">
          <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 items-baseline">
            <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">File Name</span>
            <span className="truncate">{file.name}</span>

            <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Path</span>
            <span className="overflow-x-auto whitespace-normal break-words">{file.path}</span>

            {'size' in file && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Size</span>
              <span>{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
            </>)}
            {'format' in file && file.format && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Format</span>
              <span>{file.format}</span>
            </>)}
            {'file_type' in file && file.file_type && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">File Type</span>
              <span>{file.file_type}</span>
            </>)}
            {'duration' in file && file.duration && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Duration</span>
              <span>{file.duration}</span>
            </>)}
            {'width' in file && file.width && file.height && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Resolution</span>
              <span>{file.width} × {file.height}</span>
            </>)}
            {'fps' in file && file.fps != null && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Frame Rate</span>
              <span>{file.fps.toFixed(2)} fps</span>
            </>)}
            {'codec' in file && file.codec && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Codec</span>
              <span>{file.codec}</span>
            </>)}
            {'bitrate' in file && file.bitrate != null && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Bitrate</span>
              <span>{(file.bitrate / 1000).toFixed(0)} kbps</span>
            </>)}
            {'created_at' in file && file.created_at && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Created</span>
              <span>{new Date(file.created_at as unknown as string).toLocaleString('en-US', { timeZoneName: 'short' })}</span>
            </>)}
            {'modified_at' in file && file.modified_at && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Modified</span>
              <span>{new Date(file.modified_at as unknown as string).toLocaleString('en-US', { timeZoneName: 'short' })}</span>
            </>)}
            {'last_scanned_at' in file && file.last_scanned_at && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Last Scanned</span>
              <span>{new Date(file.last_scanned_at as unknown as string).toLocaleString('en-US', { timeZoneName: 'short' })}</span>
            </>)}
            {'files' in file && (<>
              <span className="font-medium text-sm text-muted-foreground whitespace-nowrap">Files</span>
              <span>{file.files.length}</span>
            </>)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
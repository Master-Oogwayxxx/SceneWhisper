import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { File } from '@/types/types';
import { VideoIcon, FileText, ListPlus, Clapperboard } from 'lucide-react';
import { FileModal } from '@/components/FileModal';
import { SubtitleEditorModal } from '@/components/SubtitleEditorModal';
import { fileApi } from '@/api/files';
import { SceneViewerModal } from '@/components/SceneViewerModal';
import { useQueryClient } from '@tanstack/react-query';

interface FileGroupModalProps {
  files: File[];
  setFiles: React.Dispatch<React.SetStateAction<File[]>>;
  isOpen: boolean;
  onClose: () => void;
  /**
   * Opens the task-creation flow for the given file (used for the origin video).
   * @param file - Video file to attach to the new task
   */
  onCreateTaskForOrigin?: (file: File) => void;
}

export const FileGroupModal = ({
  files,
  setFiles,
  isOpen,
  onClose,
  onCreateTaskForOrigin,
}: FileGroupModalProps) => {
  if (!files || files.length === 0) {
    return null;
  }

  // Categorize files by type
  const videos = files.filter(file =>
    file.name.endsWith('.mp4') || file.name.endsWith('.mkv') || file.name.endsWith('.avi')
  );

  const subtitles = files.filter(file => file.name.endsWith('.srt'));

  // Find the video that does not have a numeric suffix (e.g., "-001") - this is likely the "origin" video
  const originVideo = videos.find(video => !/-\d{3}(?=\.\w+$|$)/.test(video.name.replace(/\.[^/.]+$/, '')));

  // Separate the origin video from other videos
  const regularVideos = originVideo ? videos.filter(video => video.id !== originVideo.id) : videos;

  const queryClient = useQueryClient();

  const [fileInfo, setFileInfo] = useState<File | null>(null);
  const [isFileInfoModalOpen, setIsFileInfoModalOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<File | null>(null);
  const [subtitleToEdit, setSubtitleToEdit] = useState<File | null>(null);
  const [isSubtitleEditorOpen, setIsSubtitleEditorOpen] = useState(false);
  const [sceneFile, setSceneFile] = useState<File | null>(null);
  const [isSceneViewerOpen, setIsSceneViewerOpen] = useState(false);
  const [deleteFromDisk, setDeleteFromDisk] = useState(true);
  const [deleteFromDatabase, setDeleteFromDatabase] = useState(true);

  const handleConfirmDelete = async () => {
    if (!fileToDelete) return;
    try {
      await fileApi.deleteFile(fileToDelete.id, { deleteFromDisk, deleteFromDatabase });
      if (deleteFromDatabase) {
        setFiles(files.filter((f: File) => f.id !== fileToDelete.id));
      }
      queryClient.invalidateQueries({ queryKey: ['files'] });
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Failed to delete file. Please try again.');
    } finally {
      setFileToDelete(null);
    }
  };

  const handleViewFileInfo = (file: File) => {
    setFileInfo(file);
    setIsFileInfoModalOpen(true);
  };

  const handleDeleteFile = (file: File) => {
    setFileToDelete(file);
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-3xl max-h-[95vh] overflow-y-auto scrollbar">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>Processed Files</DialogTitle>
            </div>
          </DialogHeader>
          <div className="py-4">
            {originVideo && (
              <div className="mb-6">
                <h3 className="font-medium text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  <VideoIcon className="w-4 h-4" />
                  Video Origin
                </h3>
                <div className="space-y-2">
                  <div key={originVideo.id} className="flex items-center justify-between p-2 bg-secondary/50 rounded-md">
                    <span className="truncate">{originVideo.name}</span>
                    <div className="flex flex-wrap gap-2 justify-end">
                      {onCreateTaskForOrigin && (
                        <Button
                          variant="default"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => onCreateTaskForOrigin(originVideo)}
                        >
                          <ListPlus className="h-3.5 w-3.5" aria-hidden />
                          New task
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => { setSceneFile(originVideo); setIsSceneViewerOpen(true); }}>
                        <Clapperboard className="h-3.5 w-3.5 mr-1" aria-hidden />
                        Scenes
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleViewFileInfo(originVideo)}>View File Info</Button>
                      <Button variant="destructive" size="sm" onClick={() => handleDeleteFile(originVideo)}>Delete</Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {regularVideos.length > 0 && (
              <div className="mb-6">
                <h3 className="font-medium text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  <VideoIcon className="w-4 h-4" />
                  Videos Split ({regularVideos.length})
                </h3>
                <div className="space-y-2">
                  {regularVideos.map(file => (
                    <div key={file.id} className="flex items-center justify-between p-2 bg-secondary/50 rounded-md">
                      <span className="truncate">{file.name}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleViewFileInfo(file)}>View File Info</Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteFile(file)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {subtitles.length > 0 && (
              <div className="mb-6">
                <h3 className="font-medium text-sm text-muted-foreground mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Subtitles ({subtitles.length})
                </h3>
                <div className="space-y-2">
                  {subtitles.map(file => (
                    <div key={file.id} className="flex items-center justify-between p-2 bg-secondary/50 rounded-md">
                      <span className="truncate">{file.name}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => { setSubtitleToEdit(file); setIsSubtitleEditorOpen(true); }}>Edit</Button>
                        <Button variant="outline" size="sm" onClick={() => handleViewFileInfo(file)}>View File Info</Button>
                        <Button variant="destructive" size="sm" onClick={() => handleDeleteFile(file)}>Delete</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {fileInfo && (
        <FileModal
          file={fileInfo}
          isOpen={isFileInfoModalOpen}
          onClose={() => setIsFileInfoModalOpen(false)}
        />
      )}

      <SubtitleEditorModal
        file={subtitleToEdit}
        isOpen={isSubtitleEditorOpen}
        onClose={() => { setIsSubtitleEditorOpen(false); setSubtitleToEdit(null); }}
      />

      <SceneViewerModal
        file={sceneFile}
        isOpen={isSceneViewerOpen}
        onClose={() => { setIsSceneViewerOpen(false); setSceneFile(null); }}
      />

      <Dialog open={!!fileToDelete} onOpenChange={(open) => !open && setFileToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>
              Choose where to delete <span className="font-medium">{fileToDelete?.name}</span>. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={deleteFromDisk}
                onCheckedChange={(checked) => setDeleteFromDisk(checked === true)}
              />
              <span className="leading-5">Delete file on disk</span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={deleteFromDatabase}
                onCheckedChange={(checked) => setDeleteFromDatabase(checked === true)}
              />
              <span className="leading-5">Delete record in database</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFileToDelete(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!deleteFromDisk && !deleteFromDatabase} onClick={handleConfirmDelete}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

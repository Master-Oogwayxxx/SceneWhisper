import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { File } from '@/types/types';
import { VideoIcon, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FileGroupCardProps {
  files: File[];
  onOpenDetails: (files: File[]) => void;
  selected?: boolean;
  className?: string;
}

export const FileGroupCard = ({ files, onOpenDetails, selected = false, className }: FileGroupCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Find the shortest filename to use as the base for grouping
  const shortestFile = files.reduce((shortest, file) =>
    file.name.length < shortest.name.length ? file : shortest, files[0]);

  // Count videos and subtitles in this group
  const videoCount = files.filter(file =>
    file.name.endsWith('.mp4') || file.name.endsWith('.mkv') || file.name.endsWith('.avi')).length;

  const subtitleCount = files.filter(file => file.name.endsWith('.srt')).length;

  return (
    <Card className={`cursor-pointer hover:shadow-lg transition-shadow duration-200 border-border ${selected ? 'ring-2 ring-primary' : ''} ${className ?? ''}`}>
      <CardContent
        className="p-4"
        onClick={(e) => {
          // Prevent the card click from propagating to parent handlers
          e.stopPropagation();
          // Open the details modal when card is clicked
          onOpenDetails(files);
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center justify-center w-10 h-10 bg-primary/10 rounded-lg">
              <VideoIcon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="font-medium text-sm truncate max-w-[200px]">{shortestFile.name.replace(/\.[^/.]+$/, '').match(/^(.*?)(-\d+)$/)?.[1] ?? shortestFile.name.replace(/\.[^/.]+$/, '')}</h3>
              <div className="text-xs text-muted-foreground mt-1">
                <p>{videoCount} videos, {subtitleCount} subtitles</p>
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </Button>
        </div>

        {isExpanded && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="space-y-2">
              {files.map(file => (
                <div key={file.id} className="flex items-center gap-2 text-sm">
                  {file.name.endsWith('.mp4') || file.name.endsWith('.mkv') || file.name.endsWith('.avi') ?
                    <VideoIcon className="w-4 h-4 text-primary" /> :
                    file.name.endsWith('.srt') ?
                      <FileText className="w-4 h-4 text-primary" /> :
                      <FileText className="w-4 h-4 text-primary" />}
                  <span className="truncate">{file.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

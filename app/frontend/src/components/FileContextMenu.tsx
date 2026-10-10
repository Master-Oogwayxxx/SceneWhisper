import { File } from '@/types/types';
import { MoreHorizontal, Info, Trash2 } from 'lucide-react';

interface FileContextMenuProps {
  file: File;
  onClose: () => void;
  onViewInfo: (file: File) => void;
  onDeleteFile: (file: File) => void;
  position?: { x: number; y: number };
}

export function FileContextMenu({ file, onClose, onViewInfo, onDeleteFile, position }: FileContextMenuProps) {
  // Default positioning if no position provided
  const style: React.CSSProperties = position ? {
    position: 'fixed',
    top: `${position.y}px`,
    left: `${position.x}px`,
    zIndex: 50,
    transform: 'translateY(0)'
  } : {
    position: 'absolute',
    top: '0',
    left: '0',
    zIndex: 50
  };

  return (
    <div
      className="bg-muted border rounded-md shadow-lg py-2 z-50"
      style={style}
    >
      <button
        className="w-full text-left px-4 py-2 hover:bg-gray-700 flex items-center gap-2 text-white"
        onClick={() => {
          onViewInfo(file);
          onClose();
        }}
      >
        <Info className="w-4 h-4" />
        View File Info
      </button>
      <button
        className="w-full text-left px-4 py-2 hover:bg-red-300 text-red-600 flex items-center gap-2"
        onClick={() => {
          onDeleteFile(file);
          onClose();
        }}
      >
        <Trash2 className="w-4 h-4" />
        Delete File
      </button>
    </div>
  );
}
import React, { createContext, useContext } from 'react';
import { Directory, File } from '@/types/types';

interface SidebarContextType {
  folders: Directory[];
  onFileSelect: (file: File) => void;
  selectedFileId?: string;
  onScan: () => void;
  isScanning: boolean;
  multiSelect?: boolean;
  selectedFiles?: File[];
  onSelectionChange?: (files: File[]) => void;
  onToggleMultiSelect?: () => void;
  onLoadDirectory?: (path: string) => Promise<void>;
  onViewFileInfo?: (file: File) => void;
  onDeleteFile?: (file: File) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export const useSidebarContext = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebarContext must be used within a SidebarProvider');
  }
  return context;
};

export const SidebarProvider: React.FC<{
  value: SidebarContextType;
  children: React.ReactNode
}> = ({ value, children }) => {
  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
};
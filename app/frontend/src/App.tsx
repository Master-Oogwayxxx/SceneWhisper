import React, { useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { Dashboard } from './pages/Dashboard';
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { useSettings } from './hooks/useSettings'
import { Notification, AppTab } from '@/types/types'

const queryClient = new QueryClient()
const TAB_QUERY_PARAM = 'tab'
const APP_TABS = ['files', 'tasks', 'monitors', 'stats', 'logs', 'actresses', 'scraper', 'deleted-history', 'tools'] as const
const FILE_QUERY_PARAMS = [
  'q', 'page', 'pageSize', 'sort', 'dir', 'grouped', 'type', 'format', 'date',
  'hasScenes', 'hasSplit', 'hasSubtitle', 'noScenes', 'noSplit', 'noSubtitle',
  'status', 'queueDisabled', 'queueEnabled', 'splitDisabled', 'splitEnabled',
  'subtitleDisabled', 'subtitleEnabled', 'noNumberSuffix', 'newVideos', 'content',
  'resolution', 'sizeOp', 'size', 'dirs', 'dirExclude',
]
const MONITOR_QUERY_PARAMS = ['page', 'pageSize']

function isAppTab(value: string | null): value is AppTab {
  return APP_TABS.some((tab) => tab === value)
}

function getInitialTab(): AppTab {
  if (typeof window === 'undefined') return 'files'

  const urlTab = new URLSearchParams(window.location.search).get(TAB_QUERY_PARAM)
  return isAppTab(urlTab) ? urlTab : 'files'
}

function AppContent() {
  const [tab, setTab] = useState<AppTab>(getInitialTab);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [highlightedFileId, setHighlightedFileId] = useState<string | null>(null);
  const { settings, patchSettings } = useSettings()
  const hideStatsControls = tab === 'actresses' || tab === 'monitors' || tab === 'scraper' || tab === 'deleted-history'
  const statsMinimized = !settings.show_stats_panel || tab === 'logs' || hideStatsControls

  useEffect(() => {
    const url = new URL(window.location.href)
    if (tab !== 'files' && tab !== 'tasks' && tab !== 'monitors') {
      const params = new URLSearchParams()
      params.set(TAB_QUERY_PARAM, tab)
      url.search = params.toString()
      window.history.replaceState(window.history.state, '', url)
      return
    }

    const params = url.searchParams
    params.set(TAB_QUERY_PARAM, tab)
    if (tab === 'files') {
      Array.from(params.keys()).forEach((key) => {
        if (key.startsWith('tasks.') || key.startsWith('monitors.')) params.delete(key)
      })
    } else if (tab === 'tasks') {
      FILE_QUERY_PARAMS.forEach((key) => {
        params.delete(key)
        params.delete(`files.${key}`)
      })
      MONITOR_QUERY_PARAMS.forEach((key) => params.delete(`monitors.${key}`))
    } else {
      FILE_QUERY_PARAMS.forEach((key) => {
        params.delete(key)
        params.delete(`files.${key}`)
      })
      Array.from(params.keys()).forEach((key) => {
        if (key.startsWith('tasks.')) params.delete(key)
      })
    }
    window.history.replaceState(window.history.state, '', url)
  }, [tab])

  useEffect(() => {
    const handlePopState = () => {
      const urlTab = new URLSearchParams(window.location.search).get(TAB_QUERY_PARAM)
      setTab(isAppTab(urlTab) ? urlTab : 'files')
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const handleNavigate = (notification: Notification) => {
    if (notification.task_id) {
      setTab('tasks')
      setHighlightedTaskId(notification.task_id)
      setTimeout(() => setHighlightedTaskId(null), 2000)
    } else if (notification.file_id) {
      setTab('files')
      setHighlightedFileId(notification.file_id)
      setTimeout(() => setHighlightedFileId(null), 2000)
    }
  }

  return (
    <TooltipProvider>
      <Toaster />
      <div className="flex h-[100dvh] min-h-0 flex-col gap-2 overflow-hidden bg-background sm:gap-4">
        <Navbar tab={tab} onTabChange={setTab} statsMinimized={statsMinimized} onToggleStats={hideStatsControls ? undefined : () => patchSettings({ show_stats_panel: statsMinimized })} onNavigate={handleNavigate} />
        <Dashboard tab={tab} setTab={setTab} statsMinimized={statsMinimized} highlightedTaskId={highlightedTaskId} highlightedFileId={highlightedFileId} />
      </div>
    </TooltipProvider>
  )
}

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
};

export default App;

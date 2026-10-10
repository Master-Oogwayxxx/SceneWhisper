import { useState } from 'react';
import { BarChart2, Film, Folder, History, ListTodo, Eye, Maximize2, LayoutGrid, Settings, User, SearchCode, Menu, Wrench } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './ui/button';
import { SettingsModal } from './SettingsModal';
import { NotificationBell } from './NotificationBell';
import { useNotifications } from '@/hooks/useNotifications';
import { Notification, AppTab } from '@/types/types'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from './ui/sheet';

interface NavbarProps {
    tab: AppTab;
    onTabChange: (tab: AppTab) => void;
    statsMinimized?: boolean;
    onToggleStats?: () => void;
    onNavigate?: (notification: Notification) => void;
}

const TABS = [
    { value: 'files', label: 'All Files', Icon: Folder },
    { value: 'monitors', label: 'Directory Monitors', Icon: Eye },
    { value: 'tasks', label: 'Task Queue', Icon: ListTodo },
    { value: 'actresses', label: 'Actresses', Icon: User },
    { value: 'scraper', label: 'Scraper', Icon: SearchCode },
    { value: 'tools', label: 'Tools', Icon: Wrench },
    { value: 'stats', label: 'Statistics', Icon: BarChart2 },
    { value: 'deleted-history', label: 'Deleted History', Icon: History },
    { value: 'logs', label: 'Logs', Icon: ListTodo },
] as const;

export const Navbar = ({ tab, onTabChange, statsMinimized, onToggleStats, onNavigate }: NavbarProps) => {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isNavOpen, setIsNavOpen] = useState(false);
    const [isMobileNotificationsOpen, setIsMobileNotificationsOpen] = useState(false);
    const [isDesktopNotificationsOpen, setIsDesktopNotificationsOpen] = useState(false);
    const queryClient = useQueryClient();
    const activeTab = TABS.find((item) => item.value === tab) ?? TABS[0];
    const notificationState = useNotifications(
        () => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
        },
        () => {
            queryClient.invalidateQueries({ queryKey: ['r18'] })
        },
    );

    const handleTabChange = (value: AppTab) => {
        onTabChange(value);
        setIsNavOpen(false);
    };

    return (
        <nav className="z-50 border-b border-border bg-card/50 px-3 py-2 backdrop-blur-xl sm:px-6">
            <div className="flex min-h-0 flex-col gap-2 min-[1920px]:flex-row min-[1920px]:items-center min-[1920px]:gap-6">
                <div className="flex items-center gap-3">
                    <Sheet open={isNavOpen} onOpenChange={setIsNavOpen}>
                        <SheetTrigger asChild>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 min-[1920px]:hidden"
                                aria-label="Open navigation"
                                title="Navigation"
                            >
                                <Menu className="h-3.5 w-3.5" aria-hidden />
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="flex w-[min(20rem,86vw)] flex-col p-0">
                            <SheetHeader className="border-b border-border px-4 py-4 text-left">
                                <SheetTitle className="flex items-center gap-3">
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                        <Film className="w-4 h-4 text-primary" aria-hidden />
                                    </span>
                                    <span className="min-w-0">
                                        <span className="block text-base font-semibold">SceneWhisper</span>
                                        <span className="block truncate text-xs font-normal text-muted-foreground">{activeTab.label}</span>
                                    </span>
                                </SheetTitle>
                            </SheetHeader>
                            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
                                {TABS.map(({ value, label, Icon }) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => handleTabChange(value)}
                                        className={`flex h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-sm font-medium transition-colors ${tab === value
                                            ? 'bg-primary/10 text-foreground'
                                            : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                                            }`}
                                    >
                                        <Icon className="w-4 h-4 shrink-0" aria-hidden />
                                        <span className="truncate">{label}</span>
                                    </button>
                                ))}
                            </div>
                        </SheetContent>
                    </Sheet>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 glow sm:h-10 sm:w-10 sm:rounded-lg">
                        <Film className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-base font-semibold tracking-tight sm:text-lg">SceneWhisper</h1>
                        <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Video Processing Suite</p>
                    </div>
                    <div className="ml-auto flex items-center gap-1 min-[1920px]:hidden">
                        {onToggleStats && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={onToggleStats}
                                aria-label={statsMinimized ? 'Show statistics' : 'Hide statistics'}
                                title={statsMinimized ? 'Show statistics' : 'Hide statistics'}
                            >
                                {statsMinimized ? (
                                    <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                                ) : (
                                    <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                                )}
                            </Button>
                        )}
                        <NotificationBell
                            unreadCount={notificationState.unreadCount}
                            isOpen={isMobileNotificationsOpen}
                            onOpenChange={setIsMobileNotificationsOpen}
                            notifications={notificationState.notifications}
                            onMarkRead={notificationState.markRead}
                            onMarkAllRead={notificationState.markAllRead}
                            onClearAll={notificationState.clearAll}
                            onNavigate={onNavigate}
                        />
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setIsSettingsOpen(true)}
                            aria-label="Open settings"
                            title="Settings"
                        >
                            <Settings className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                    </div>
                </div>

                <div className="scrollbar -mx-1 hidden min-w-0 items-center gap-1 overflow-x-auto px-1 pb-1 min-[1920px]:flex min-[1920px]:h-full min-[1920px]:pb-0">
                    {TABS.map(({ value, label, Icon }) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => onTabChange(value)}
                            className={`flex h-9 shrink-0 items-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${tab === value
                                ? 'text-foreground bg-primary/10'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <Icon className="w-4 h-4" />
                            {label}
                        </button>
                    ))}
                </div>

                <div className="ml-auto hidden items-center gap-2 min-[1920px]:flex">
                    {onToggleStats && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={onToggleStats}
                            aria-label={statsMinimized ? 'Show statistics' : 'Hide statistics'}
                            title={statsMinimized ? 'Show statistics' : 'Hide statistics'}
                        >
                            {statsMinimized ? (
                                <LayoutGrid className="w-4 h-4" aria-hidden />
                            ) : (
                                <Maximize2 className="w-4 h-4" aria-hidden />
                            )}
                        </Button>
                    )}
                    <NotificationBell
                        unreadCount={notificationState.unreadCount}
                        isOpen={isDesktopNotificationsOpen}
                        onOpenChange={setIsDesktopNotificationsOpen}
                        notifications={notificationState.notifications}
                        onMarkRead={notificationState.markRead}
                        onMarkAllRead={notificationState.markAllRead}
                        onClearAll={notificationState.clearAll}
                        onNavigate={onNavigate}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsSettingsOpen(true)}
                        aria-label="Open settings"
                        title="Settings"
                    >
                        <Settings className="w-4 h-4" aria-hidden />
                    </Button>
                </div>
            </div>
            <SettingsModal open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
        </nav>
    );
};

import { Bell } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Notification } from '@/types/types'
import { NotificationPanel } from './NotificationPanel'

interface NotificationBellProps {
  unreadCount: number
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  notifications: Notification[]
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onClearAll: () => void
  onNavigate?: (notification: Notification) => void
}

export const NotificationBell = ({
  unreadCount,
  isOpen,
  onOpenChange,
  notifications,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
  onNavigate,
}: NotificationBellProps) => {
  const handleNavigate = (notification: Notification) => {
    onNavigate?.(notification)
    onOpenChange(false)
  }
  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 sm:h-9 sm:w-9"
          aria-label="Open notifications"
          title="Notifications"
        >
          <Bell className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1.5 -top-1.5 flex h-4 w-6 items-center justify-center p-0 text-[10px] sm:-right-2 sm:-top-2 sm:h-5 sm:w-7 sm:text-xs"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(calc(100vw-1rem),24rem)] p-0" align="end">
        <NotificationPanel
          notifications={notifications}
          onMarkRead={onMarkRead}
          onMarkAllRead={onMarkAllRead}
          onClearAll={onClearAll}
          onNavigate={handleNavigate}
        />
      </PopoverContent>
    </Popover>
  )
}

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Notification } from '@/types/types'
import { NotificationItem } from './NotificationItem'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface NotificationPanelProps {
  notifications: Notification[]
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onClearAll: () => void
  onNavigate?: (notification: Notification) => void
}

export const NotificationPanel = ({
  notifications,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
  onNavigate,
}: NotificationPanelProps) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="flex w-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <h2 className="font-semibold text-sm">Notifications</h2>
        <div className="flex min-w-0 shrink-0 gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onMarkAllRead}
          >
            Mark All Read
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onClearAll}
          >
            Clear All
          </Button>
        </div>
      </div>

      <div className={`min-h-0 overflow-y-auto scrollbar transition-[max-height] duration-300 ease-in-out ${expanded ? 'max-h-[calc(95vh-4rem)]' : 'max-h-[28rem]'}`}>
        {notifications.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No notifications
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={onMarkRead}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

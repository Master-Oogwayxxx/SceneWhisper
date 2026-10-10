import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Notification } from '@/types/types'
import { Button } from '@/components/ui/button'
import { Copy, Check } from 'lucide-react'
import { copyTextToClipboard } from '@/lib/utils'

interface NotificationItemProps {
  notification: Notification
  onMarkRead: (id: string) => void
  onNavigate?: (notification: Notification) => void
}

export const NotificationItem = ({ notification, onMarkRead, onNavigate }: NotificationItemProps) => {
  const [expanded, setExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const messageRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (messageRef.current && !expanded) {
      setIsTruncated(messageRef.current.scrollHeight > messageRef.current.clientHeight)
    }
  }, [notification.message, expanded])

  const getBorderColor = (type: string): string => {
    switch (type) {
      case 'task_completed':
        return 'border-l-green-500'
      case 'task_failed':
        return 'border-l-red-500'
      case 'r18_import_failed':
        return 'border-l-red-500'
      case 'r18_import_completed':
        return 'border-l-green-500'
      case 'scraper_completed':
        return 'border-l-green-500'
      case 'task_cancelled':
        return 'border-l-yellow-500'
      default:
        return 'border-l-blue-500'
    }
  }

  const getLocalTimestamp = (isoString: string): string => {
    try {
      const s = isoString.endsWith('Z') ? isoString : isoString + 'Z'
      return new Date(s).toLocaleString()
    } catch {
      return 'unknown'
    }
  }

  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    const text = `${notification.title}\n${notification.message}`
    copyTextToClipboard(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {
      // Keep the current UI silent on copy failure.
    })
  }

  const handleClick = () => {
    if (window.getSelection()?.toString()) return
    if (!notification.is_read) {
      onMarkRead(notification.id)
    }
    if (onNavigate) {
      onNavigate(notification)
    } else {
      setExpanded(prev => !prev)
    }
  }

  return (
    <div
      className={cn(
        'border-l-4 p-3 cursor-pointer transition-colors hover:bg-secondary',
        getBorderColor(notification.type),
        notification.is_read ? 'opacity-60' : 'opacity-100'
      )}
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-sm font-medium truncate',
              notification.is_read && 'text-muted-foreground'
            )}
          >
            {notification.title}
          </p>
          <p
            ref={messageRef}
            className={cn('text-xs text-muted-foreground mt-1', !expanded && 'line-clamp-2')}
          >
            {notification.message}
          </p>
          {!expanded && isTruncated && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs mt-1"
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(true)
              }}
            >
              More
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={handleCopy}
            title="Copy"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </Button>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {getLocalTimestamp(notification.created_at)}
          </span>
        </div>
      </div>
    </div>
  )
}

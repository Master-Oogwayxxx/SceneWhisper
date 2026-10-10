import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Notification, NotificationType } from '@/types/types'
import { notificationApi } from '@/api/notifications'
import { apiWebSocketUrl } from '@/api/client'

const TASK_EVENT_TYPES: NotificationType[] = [
  'task_queued',
  'task_started',
  'task_completed',
  'task_failed',
  'task_cancelled',
  'task_paused',
  'task_unpaused',
  'task_already_exists',
]

const R18_EVENT_TYPES: NotificationType[] = [
  'r18_import_started',
  'r18_download_started',
  'r18_download_completed',
  'r18_importing',
  'r18_import_completed',
  'r18_import_failed',
]

const SUPPRESS_TOAST_TYPES: NotificationType[] = ['scan_started', 'files_found', 'task_paused']

export const useNotifications = (onTaskEvent?: () => void, onR18Event?: () => void) => {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectDelayRef = useRef(1000)

  // Fetch initial notifications from REST API
  const hydrate = async () => {
    try {
      const response = await notificationApi.getNotifications(1, 50)
      setNotifications(response.notifications)
      setUnreadCount(response.unread_count)
    } catch (error) {
      console.error('Failed to hydrate notifications:', error)
    }
  }

  // Connect to WebSocket
  const connectWebSocket = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      const wsUrl = apiWebSocketUrl('/ws/notifications')
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        console.log('WebSocket connected')
        reconnectDelayRef.current = 1000 // Reset backoff on success
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          if (message.event === 'notification' && message.data) {
            const notification: Notification = message.data
            // Prepend new notification, cap at 200 to prevent memory bloat
            setNotifications((prev) => {
              const next = [notification, ...prev]
              return next.length > 200 ? next.slice(0, 200) : next
            })
            setUnreadCount((prev) => prev + 1)

            // Fire toast notification with type-specific variant
            if (!SUPPRESS_TOAST_TYPES.includes(notification.type)) {
              const variant = getToastVariant(notification.type)
              toast[variant](notification.title, {
                description: notification.message,
              })
            }

            if (TASK_EVENT_TYPES.includes(notification.type)) {
              onTaskEvent?.()
            }

            if (R18_EVENT_TYPES.includes(notification.type)) {
              onR18Event?.()
            }
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error)
        }
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
      }

      ws.onclose = () => {
        console.log('WebSocket disconnected, attempting reconnect...')
        wsRef.current = null
        scheduleReconnect()
      }

      wsRef.current = ws
    } catch (error) {
      console.error('Failed to connect WebSocket:', error)
      scheduleReconnect()
    }
  }

  // Schedule reconnection with exponential backoff
  const scheduleReconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }

    const delay = Math.min(reconnectDelayRef.current, 30000) // Cap at 30s
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000)
      connectWebSocket()
    }, delay)
  }

  // Get toast variant based on notification type
  const getToastVariant = (type: NotificationType): 'error' | 'success' | 'info' | 'warning' => {
    if (type === 'task_failed' || type === 'r18_import_failed') return 'error'
    if (type === 'task_completed' || type === 'r18_import_completed' || type === 'scraper_completed') return 'success'
    if (type === 'task_unpaused') return 'success'
    if (type === 'task_paused') return 'info'
    if (type === 'task_already_exists') return 'warning'
    if (type === 'system_warning') return 'warning'
    return 'info'
  }

  // Mark a notification as read
  const markRead = async (id: string) => {
    try {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
      await notificationApi.markRead(id)
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
      // Revert optimistic update
      await hydrate()
    }
  }

  // Mark all notifications as read
  const markAllRead = async () => {
    try {
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnreadCount(0)
      await notificationApi.markAllRead()
    } catch (error) {
      console.error('Failed to mark all as read:', error)
      // Revert optimistic update
      await hydrate()
    }
  }

  // Clear all notifications
  const clearAll = async () => {
    try {
      setNotifications([])
      setUnreadCount(0)
      await notificationApi.clearAll()
    } catch (error) {
      console.error('Failed to clear all notifications:', error)
      // Revert optimistic update
      await hydrate()
    }
  }

  // Initialize: hydrate and connect
  useEffect(() => {
    hydrate()
    connectWebSocket()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

  return {
    notifications,
    unreadCount,
    isOpen,
    setIsOpen,
    markRead,
    markAllRead,
    clearAll,
  }
}

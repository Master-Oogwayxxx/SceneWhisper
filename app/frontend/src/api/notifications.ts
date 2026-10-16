import { Notification, NotificationsResponse } from '@/types/types'

import { apiUrl } from '@/api/client'

export const notificationApi = {
  async getNotifications(page: number = 1, limit: number = 50): Promise<NotificationsResponse> {
    const res = await fetch(apiUrl(`/notifications?page=${page}&limit=${limit}`))
    if (!res.ok) {
      throw new Error('Failed to fetch notifications')
    }
    return res.json()
  },

  async markRead(id: string): Promise<void> {
    const res = await fetch(apiUrl(`/notifications/${id}/read`), {
      method: 'PATCH',
    })
    if (!res.ok) {
      throw new Error('Failed to mark notification as read')
    }
  },

  async markAllRead(): Promise<void> {
    const res = await fetch(apiUrl('/notifications/read-all'), {
      method: 'POST',
    })
    if (!res.ok) {
      throw new Error('Failed to mark all notifications as read')
    }
  },

  async clearAll(): Promise<void> {
    const res = await fetch(apiUrl('/notifications'), {
      method: 'DELETE',
    })
    if (!res.ok) {
      throw new Error('Failed to clear notifications')
    }
  },
}

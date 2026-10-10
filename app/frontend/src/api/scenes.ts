import { Scene } from '@/types/types'
import axios from 'axios'
import { API_BASE } from '@/api/client'

export const sceneApi = {
  async getScenesForFile(fileId: string): Promise<Scene[]> {
    const res = await axios.get(`${API_BASE}/scenes/file/${fileId}`)
    return res.data
  },

  async getSceneCount(fileId: string): Promise<{ file_id: string; count: number }> {
    const res = await axios.get(`${API_BASE}/scenes/file/${fileId}/count`)
    return res.data
  },

  async updateScene(sceneId: string, startTimecode: string, endTimecode: string, queueTask: boolean = true): Promise<Scene> {
    const res = await axios.put(`${API_BASE}/scenes/${sceneId}`, {
      start_timecode: startTimecode,
      end_timecode: endTimecode,
      queue_task: queueTask,
    })
    return res.data
  },

  async deleteScene(sceneId: string): Promise<void> {
    await axios.delete(`${API_BASE}/scenes/${sceneId}`)
  },

  async deleteScenesForFile(fileId: string): Promise<void> {
    await axios.delete(`${API_BASE}/scenes/file/${fileId}`)
  },

  async createScene(fileId: string, startTimecode: string, endTimecode: string): Promise<Scene> {
    const res = await axios.post(`${API_BASE}/scenes`, {
      file_id: fileId,
      start_timecode: startTimecode,
      end_timecode: endTimecode,
    })
    return res.data
  },
}

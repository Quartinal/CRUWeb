import type { RecoveryImage, DeviceInfo, FlashProgress } from '../types'
import { checkStorageRequirements } from '../utils/storage'

import { createStore } from 'solid-js/store'

interface RecoveryState {
  images: RecoveryImage[]
  selectedImage: RecoveryImage | null
  deviceInfo: DeviceInfo | null
  flashProgress: FlashProgress
  error: string | null
}

export const [state, setState] = createStore<RecoveryState>({
  images: [],
  selectedImage: null,
  deviceInfo: null,
  flashProgress: {
    bytesWritten: 0,
    totalBytes: 0,
    speed: 0,
    timeRemaining: 0,
    status: 'idle',
  },
  error: null,
})

export const actions = {
  async fetchImages() {
    try {
      const urls = ['/cdn/recovery2.json', '/cdn/cloudready_recovery2.json']

      const responses = await Promise.all(urls.map(url => fetch(url)))
      const data = await Promise.all(responses.map(r => r.json()))

      setState('images', [...data[0], ...data[1]])
    } catch (e) {
      setState('error', 'Failed to fetch recovery images')
    }
  },

  async selectImage(image: RecoveryImage) {
    const storage = await checkStorageRequirements(image.filesize)
    if (!storage.isAdequate) {
      setState('error', 'Insufficient storage space')
      return false
    }

    setState('selectedImage', image)
    return true
  },
}

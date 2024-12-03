import type { StorageRequirements } from '../types'

export async function checkStorageRequirements(
  fileSize: number,
): Promise<StorageRequirements> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate()
    const availableBytes = estimate.quota! - estimate.usage!

    return {
      requiredBytes: fileSize,
      availableBytes,
      isAdequate: availableBytes > fileSize * 1.5, // 50% buffer
    }
  }

  return {
    requiredBytes: fileSize,
    availableBytes: Infinity,
    isAdequate: true,
  }
}

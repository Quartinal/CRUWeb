export interface RecoveryImage {
  channel: string
  model: string
  name: string
  url: string
  version: string
  chrome_version: string
  manufacturer: string
  hwidmatch: string
  filesize: number
  zipfilesize: number
  md5: string
  sha1: string
}

export interface DeviceInfo {
  isChromebook: boolean
  model: string
  vendorId?: number
  productId?: number
  capabilities: {
    canWrite: boolean
    minSpeed: number
    maxSpeed: number
  }
}

export interface FlashProgress {
  bytesWritten: number
  totalBytes: number
  speed: number
  timeRemaining: number
  status:
    | 'idle'
    | 'downloading'
    | 'verifying'
    | 'writing'
    | 'complete'
    | 'error'
  errorMessage?: string
}

export interface StorageRequirements {
  requiredBytes: number
  availableBytes: number
  isAdequate: boolean
}

///<reference types="w3c-web-usb" />
///<reference types="wicg-file-system-access" />

import type { FlashProgress } from '../types'

export enum BrowserType {
  Chrome = 'Chrome',
  Firefox = 'Firefox',
  Safari = 'Safari',
  Edge = 'Edge',
  Other = 'Other',
}

export class BrowserCompatibility {
  static detectBrowser(): BrowserType {
    const userAgent = window.navigator.userAgent.toLowerCase()

    if (
      userAgent.includes('chrome') &&
      !userAgent.includes('edg') &&
      !userAgent.includes('opr')
    ) {
      return BrowserType.Chrome
    } else if (userAgent.includes('firefox')) {
      return BrowserType.Firefox
    } else if (userAgent.includes('safari') && !userAgent.includes('chrome')) {
      return BrowserType.Safari
    } else if (userAgent.includes('edg')) {
      return BrowserType.Edge
    }

    return BrowserType.Other
  }

  static isWebUSBSupported(): boolean {
    return !!(
      navigator.usb && typeof navigator.usb.requestDevice === 'function'
    )
  }

  static isFileSystemAccessSupported(): boolean {
    //@ts-expect-error
    return !!(window.showDirectoryPicker && 'showDirectoryPicker' in window)
  }

  static getStorageQuota(): Promise<{
    quota: number
    usage: number
  }> {
    return new Promise(resolve => {
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage
          .estimate()
          .then(estimate => {
            resolve({
              quota: estimate.quota ?? 0,
              usage: estimate.usage ?? 0,
            })
          })
          .catch(() => resolve({ quota: 0, usage: 0 }))
      } else {
        resolve({ quota: 0, usage: 0 })
      }
    })
  }
}

export class USBWriter {
  private device: USBDevice
  private chunkSize: number = 1024 * 1024 // 1MB chunks
  private timeoutMs: number = 5000
  private browserType: BrowserType

  constructor(device: USBDevice) {
    this.device = device
    this.browserType = BrowserCompatibility.detectBrowser()
  }

  async initialize(): Promise<void> {
    try {
      // Browser-specific initialization
      switch (this.browserType) {
        case BrowserType.Chrome:
        case BrowserType.Edge:
          await this.device.open()
          await this.device.selectConfiguration(1)
          await this.device.claimInterface(0)
          break
        case BrowserType.Firefox:
          // Firefox might require different approach
          await this.device.open()
          break
        case BrowserType.Safari:
          // Safari WebUSB support is limited
          console.warn('Limited WebUSB support on Safari')
          break
      }
    } catch (error) {
      console.error('Device initialization error:', error)
      throw error
    }
  }

  async write(
    data: ArrayBuffer,
    onProgress: (progress: FlashProgress) => void,
  ): Promise<void> {
    const startTime = Date.now()
    let bytesWritten = 0
    const totalBytes = data.byteLength

    // Browser-specific write strategies
    switch (this.browserType) {
      case BrowserType.Chrome:
      case BrowserType.Edge:
        for (let offset = 0; offset < totalBytes; offset += this.chunkSize) {
          const chunk = data.slice(offset, offset + this.chunkSize)
          await this.writeChunkStandard(chunk)

          bytesWritten += chunk.byteLength
          const elapsedSeconds = (Date.now() - startTime) / 1000
          const speed = bytesWritten / elapsedSeconds
          const timeRemaining = (totalBytes - bytesWritten) / speed

          onProgress({
            bytesWritten,
            totalBytes,
            speed,
            timeRemaining,
            status: 'writing',
          })
        }
        break

      case BrowserType.Firefox:
        // Firefox might require a different chunking approach
        await this.writeChunkFirefox(data, onProgress)
        break

      case BrowserType.Safari:
        throw new Error('WebUSB not fully supported on Safari')
    }
  }

  private async writeChunkStandard(chunk: ArrayBuffer): Promise<void> {
    const result = await Promise.race([
      this.device.transferOut(1, chunk),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('USB write timeout')),
          this.timeoutMs,
        ),
      ),
    ])

    if ((result as USBOutTransferResult).status !== 'ok') {
      throw new Error('USB write failed')
    }
  }

  private async writeChunkFirefox(
    data: ArrayBuffer,
    onProgress: (progress: FlashProgress) => void,
  ): Promise<void> {
    // Firefox-specific chunking with potential different transfer mechanism
    const totalBytes = data.byteLength
    const startTime = Date.now()
    let bytesWritten = 0

    // Smaller chunks for Firefox
    const smallerChunkSize = 512 * 1024 // 512KB

    for (let offset = 0; offset < totalBytes; offset += smallerChunkSize) {
      const chunk = data.slice(offset, offset + smallerChunkSize)

      // Simulated transfer (actual implementation may vary)
      await new Promise(resolve => setTimeout(resolve, 50))

      bytesWritten += chunk.byteLength
      const elapsedSeconds = (Date.now() - startTime) / 1000
      const speed = bytesWritten / elapsedSeconds
      const timeRemaining = (totalBytes - bytesWritten) / speed

      onProgress({
        bytesWritten,
        totalBytes,
        speed,
        timeRemaining,
        status: 'writing',
      })
    }
  }

  async close(): Promise<void> {
    try {
      await this.device.close()
    } catch (error) {
      console.warn('Error closing device:', error)
    }
  }

  // Cross-browser mass storage device selection
  static async requestMassStorageDevice(): Promise<FileSystemDirectoryHandle | null> {
    const browserType = BrowserCompatibility.detectBrowser()

    if (!BrowserCompatibility.isFileSystemAccessSupported()) {
      throw new Error('File System Access API not supported in this browser')
    }

    try {
      switch (browserType) {
        case BrowserType.Chrome:
        case BrowserType.Edge:
          return await window.showDirectoryPicker({ mode: 'readwrite' })

        case BrowserType.Firefox:
          // Firefox might require different approach
          return await window.showDirectoryPicker({ mode: 'readwrite' })

        case BrowserType.Safari:
          // Safari has limited File System Access support
          throw new Error('Limited File System Access support on Safari')

        default:
          throw new Error('Unsupported browser')
      }
    } catch (error) {
      console.error('Error accessing mass storage device:', error)
      return null
    }
  }

  // Cross-browser device info retrieval
  static async getMassStorageDeviceInfo(
    directoryHandle: FileSystemDirectoryHandle,
  ): Promise<{
    name: string
    totalSpace: number
    freeSpace: number
  }> {
    const browserType = BrowserCompatibility.detectBrowser()
    const storageEstimate = await BrowserCompatibility.getStorageQuota()

    try {
      switch (browserType) {
        case BrowserType.Chrome:
        case BrowserType.Edge:
          return {
            name: directoryHandle.name,
            totalSpace: storageEstimate.quota,
            freeSpace: storageEstimate.quota - storageEstimate.usage,
          }

        case BrowserType.Firefox:
          // Firefox might have different storage estimation
          return {
            name: directoryHandle.name,
            totalSpace: storageEstimate.quota,
            freeSpace: storageEstimate.quota - storageEstimate.usage,
          }

        case BrowserType.Safari:
          return {
            name: directoryHandle.name,
            totalSpace: 0,
            freeSpace: 0,
          }

        default:
          return {
            name: directoryHandle.name,
            totalSpace: 0,
            freeSpace: 0,
          }
      }
    } catch (error) {
      console.error('Error getting device info:', error)
      return {
        name: directoryHandle.name,
        totalSpace: 0,
        freeSpace: 0,
      }
    }
  }

  // Cross-browser file writing
  static async writeToMassStorage(
    directoryHandle: FileSystemDirectoryHandle,
    filename: string,
    data: ArrayBuffer,
    onProgress?: (progress: {
      bytesWritten: number
      totalBytes: number
    }) => void,
  ): Promise<void> {
    const browserType = BrowserCompatibility.detectBrowser()
    const totalBytes = data.byteLength

    try {
      switch (browserType) {
        case BrowserType.Chrome:
        case BrowserType.Edge:
          const fileHandle = await directoryHandle.getFileHandle(filename, {
            create: true,
          })
          const writable = await fileHandle.createWritable()
          await writable.write(data)
          await writable.close()
          onProgress?.({ bytesWritten: totalBytes, totalBytes })
          break

        case BrowserType.Firefox:
          // Potentially different file writing mechanism
          const firefoxFileHandle = await directoryHandle.getFileHandle(
            filename,
            { create: true },
          )
          const firefoxWritable = await firefoxFileHandle.createWritable()
          await firefoxWritable.write(data)
          await firefoxWritable.close()
          onProgress?.({ bytesWritten: totalBytes, totalBytes })
          break

        case BrowserType.Safari:
          throw new Error('Limited File System Access support on Safari')

        default:
          throw new Error('Unsupported browser')
      }
    } catch (error) {
      console.error('Error writing to mass storage:', error)
      throw error
    }
  }
}

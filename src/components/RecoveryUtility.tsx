import { Component, createSignal, createEffect, Show, For } from 'solid-js'
import { state, setState, actions } from '../stores/recovery-store'
import {
  USBWriter,
  BrowserType,
  BrowserCompatibility,
} from '../utils/usb-utils'
import { verifyImage } from '../utils/verification'
import type { DeviceInfo } from '../types'

export const RecoveryUtility: Component = () => {
  const [writer, setWriter] = createSignal<USBWriter | null>(null)
  const [fileSystemHandle, setFileSystemHandle] =
    createSignal<FileSystemDirectoryHandle | null>(null)
  const [deviceType, setDeviceType] = createSignal<
    'usb' | 'mass-storage' | null
  >(localStorage.getItem('deviceType') as 'usb' | 'mass-storage' | null)
  const [browserType] = createSignal(BrowserCompatibility.detectBrowser())
  const [browserSupportError, setBrowserSupportError] = createSignal<
    string | null
  >(null)
  const [isMassStorageConsented, setIsMassStorageConsented] = createSignal(
    localStorage.getItem('massStorageConsent') === 'true',
  )

  // New signal for model filter input
  const [modelFilter, setModelFilter] = createSignal('')

  // Filter images based on device type and model
  const [filteredImages, setFilteredImages] = createSignal<any[]>([])

  createEffect(() => {
    actions.fetchImages()
    checkBrowserSupport()

    // Restore device info from local storage if exists
    const savedDeviceInfo = localStorage.getItem('deviceInfo')
    if (savedDeviceInfo) {
      const parsedDeviceInfo = JSON.parse(savedDeviceInfo)
      setState('deviceInfo', parsedDeviceInfo)
    }
  })

  // Effect to filter images based on connected device and model filter
  createEffect(() => {
    if (state.images.length > 0) {
      const filterImages = () => {
        const lowercaseFilter = modelFilter().toLowerCase().trim()

        return state.images.filter(
          image =>
            // Filter by model filter input
            (lowercaseFilter === '' ||
              image.name.toLowerCase().includes(lowercaseFilter) ||
              image.model.toLowerCase().includes(lowercaseFilter) ||
              image.manufacturer.toLowerCase().includes(lowercaseFilter)) &&
            // Existing device-specific filtering
            (!state.deviceInfo?.model ||
              image.model
                .toLowerCase()
                .includes(state.deviceInfo!.model.toLowerCase()) ||
              image.manufacturer
                .toLowerCase()
                .includes(state.deviceInfo!.model.toLowerCase())),
        )
      }

      setFilteredImages(filterImages())
    }
  })

  const checkBrowserSupport = () => {
    let supportError = null

    switch (browserType()) {
      case BrowserType.Safari:
        if (
          !BrowserCompatibility.isWebUSBSupported() &&
          !BrowserCompatibility.isFileSystemAccessSupported()
        ) {
          supportError =
            'Limited WebUSB and File System Access support on Safari.'
        }
        break
      case BrowserType.Firefox:
        if (!BrowserCompatibility.isWebUSBSupported()) {
          supportError =
            'Partial WebUSB support on Firefox. Some features may be limited.'
        }
        break
    }

    setBrowserSupportError(supportError)
  }

  const connectDevice = async (type: 'usb' | 'mass-storage') => {
    try {
      // Save device type to local storage
      localStorage.setItem('deviceType', type)

      if (type === 'usb') {
        if (!BrowserCompatibility.isWebUSBSupported()) {
          throw new Error(`WebUSB not supported in ${browserType()}`)
        }

        const device = await navigator.usb.requestDevice({
          filters: [],
        })

        // Prepare device info
        const deviceInfo: DeviceInfo = {
          isChromebook: false, // This would ideally be detected
          model: device.productName || 'Unknown USB Device',
          vendorId: device.vendorId,
          productId: device.productId,
          capabilities: {
            canWrite: true,
            minSpeed: 10,
            maxSpeed: 480, // Assuming USB 2.0 speeds
          },
        }

        // Save device info to local storage and state
        localStorage.setItem('deviceInfo', JSON.stringify(deviceInfo))
        setState('deviceInfo', deviceInfo)

        const usbWriter = new USBWriter(device)
        await usbWriter.initialize()
        setWriter(usbWriter)
        setDeviceType('usb')
      } else {
        // Mass storage connection
        if (!isMassStorageConsented()) {
          localStorage.setItem('massStorageConsent', 'false')
          throw new Error(
            'Please check the consent checkbox for mass storage device usage',
          )
        }

        localStorage.setItem('massStorageConsent', 'true')

        if (!BrowserCompatibility.isFileSystemAccessSupported()) {
          throw new Error(
            `File System Access not supported in ${browserType()}`,
          )
        }

        const directoryHandle = await USBWriter.requestMassStorageDevice()
        if (directoryHandle) {
          // Prepare device info for mass storage
          const info = await USBWriter.getMassStorageDeviceInfo(directoryHandle)
          const deviceInfo: DeviceInfo = {
            isChromebook: false,
            model: info.name || 'Mass Storage Device',
            capabilities: {
              canWrite: true,
              minSpeed: 10,
              maxSpeed: 480,
            },
          }

          // Save device info to local storage and state
          localStorage.setItem('deviceInfo', JSON.stringify(deviceInfo))
          setState('deviceInfo', deviceInfo)

          setFileSystemHandle(directoryHandle)
          setDeviceType('mass-storage')
        }
      }
    } catch (error) {
      console.error('Device connection error:', error)
      setState('error', (error as Error).message)
    }
  }

  const resetDevice = () => {
    // Clear device-related local storage and state
    localStorage.removeItem('deviceInfo')
    localStorage.removeItem('deviceType')
    localStorage.removeItem('massStorageConsent')

    setWriter(null)
    setFileSystemHandle(null)
    setDeviceType(null)
    setState('deviceInfo', null)
    setState('selectedImage', null)
  }

  const startFlash = async () => {
    const image = state.selectedImage
    if (!image) return

    try {
      setState('flashProgress', {
        ...state.flashProgress,
        status: 'downloading',
      })

      // Download image
      const response = await fetch(image.url)
      const reader = response.body!.getReader()
      const chunks: Uint8Array[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)

        // Update download progress
        const bytesDownloaded = chunks.reduce(
          (acc, chunk) => acc + chunk.length,
          0,
        )
        setState('flashProgress', {
          ...state.flashProgress,
          bytesWritten: bytesDownloaded,
          totalBytes: image.filesize,
        })
      }

      const data = new Blob(chunks).arrayBuffer()

      // Verify image
      setState('flashProgress', { ...state.flashProgress, status: 'verifying' })
      const isValid = await verifyImage(await data, image.md5, image.sha1)
      if (!isValid) {
        throw new Error('Image verification failed')
      }

      // Write to device
      setState('flashProgress', { ...state.flashProgress, status: 'writing' })

      if (deviceType() === 'usb' && writer()) {
        // WebUSB write
        await writer()!.write(await data, progress => {
          setState('flashProgress', progress)
        })
      } else if (deviceType() === 'mass-storage' && fileSystemHandle()) {
        // Ensure mass storage consent is given
        if (!isMassStorageConsented()) {
          throw new Error('Mass storage device usage not consented')
        }

        // File System Access write
        await USBWriter.writeToMassStorage(
          fileSystemHandle()!,
          `ChromeOS_Recovery_${state.selectedImage!.chrome_version}.bin`,
          await data,
          progress => {
            setState('flashProgress', {
              ...state.flashProgress,
              bytesWritten: progress.bytesWritten,
              totalBytes: progress.totalBytes,
            })
          },
        )
      } else {
        throw new Error('No device connected')
      }

      setState('flashProgress', { ...state.flashProgress, status: 'complete' })
    } catch (e) {
      setState('flashProgress', {
        ...state.flashProgress,
        status: 'error',
        errorMessage: (e as Error).message,
      })
    }
  }

  return (
    <div class="recovery-utility">
      <header class="header">
        <h1>ChromeOS Recovery Utility</h1>
        <Show when={browserSupportError()}>
          <div class="browser-warning">{browserSupportError()}</div>
        </Show>
      </header>

      <main class="main">
        <Show when={state.error}>
          <div class="error-banner">{state.error}</div>
        </Show>

        <section class="device-selection">
          <Show
            when={!writer() && !fileSystemHandle()}
            fallback={
              <div class="connected-device-info">
                <h2>Connected Device</h2>
                <Show when={state.deviceInfo}>
                  <p>Model: {state.deviceInfo!.model}</p>
                  <button onClick={resetDevice}>Disconnect Device</button>
                </Show>
              </div>
            }
          >
            <div class="connection-options">
              <button onClick={() => connectDevice('usb')}>
                Connect USB Device
              </button>

              <div class="mass-storage-consent">
                <label>
                  <input
                    type="checkbox"
                    checked={isMassStorageConsented()}
                    onChange={e => {
                      const checked = e.currentTarget.checked
                      setIsMassStorageConsented(checked)
                      localStorage.setItem(
                        'massStorageConsent',
                        checked.toString(),
                      )
                    }}
                  />
                  I have a mass storage USB device (e.g., SanDisk, external
                  drive)
                </label>
              </div>

              <Show when={isMassStorageConsented()}>
                <button onClick={() => connectDevice('mass-storage')}>
                  Connect Mass Storage Device
                </button>
              </Show>
            </div>
          </Show>

          <Show when={writer() || fileSystemHandle()}>
            <div class="image-selection">
              <input
                type="text"
                class="model-filter-input"
                placeholder="Filter by Chromebook model, name, or manufacturer"
                value={modelFilter()}
                onInput={e => setModelFilter(e.currentTarget.value)}
              />

              <Show
                when={filteredImages().length > 0}
                fallback={
                  <div class="no-images-warning">
                    No compatible recovery images found for your device or
                    search.
                  </div>
                }
              >
                <select
                  onChange={e => {
                    const selectedIndex = e.currentTarget.selectedIndex - 1
                    if (selectedIndex >= 0) {
                      actions.selectImage(filteredImages()[selectedIndex])
                    }
                  }}
                  disabled={state.flashProgress.status !== 'idle'}
                >
                  <option value="">Select Recovery Image</option>
                  <For each={filteredImages()}>
                    {image => (
                      <option value={image.url}>
                        {image.name} (Chrome {image.chrome_version})
                      </option>
                    )}
                  </For>
                </select>

                <Show when={state.selectedImage}>
                  <div class="image-details">
                    <p>
                      Size:{' '}
                      {(
                        state.selectedImage!.filesize /
                        (1024 * 1024 * 1024)
                      ).toFixed(2)}{' '}
                      GB
                    </p>
                    <p>Chrome Version: {state.selectedImage!.chrome_version}</p>
                    <p>Manufacturer: {state.selectedImage!.manufacturer}</p>
                  </div>
                </Show>
              </Show>
            </div>

            <Show
              when={
                state.selectedImage && state.flashProgress.status === 'idle'
              }
            >
              <button onClick={startFlash} class="flash-button">
                Flash Recovery Image
              </button>
            </Show>
          </Show>
        </section>
      </main>
    </div>
  )
}

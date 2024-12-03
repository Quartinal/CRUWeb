import { Component, createSignal, createEffect, Show, For } from 'solid-js'
import { state, setState, actions } from '../stores/recovery-store'
import {
  USBWriter,
  BrowserType,
  BrowserCompatibility,
} from '../utils/usb-utils'
import { verifyImage } from '../utils/verification'

export const RecoveryUtility: Component = () => {
  const [writer, setWriter] = createSignal<USBWriter | null>(null)
  const [fileSystemHandle, setFileSystemHandle] =
    createSignal<FileSystemDirectoryHandle | null>(null)
  const [deviceType, setDeviceType] = createSignal<'usb' | 'mass-storage'>(
    'usb',
  )
  const [_, setDeviceInfo] = createSignal<{
    name: string
    totalSpace: number
    freeSpace: number
  } | null>(null)
  const [browserType] = createSignal(BrowserCompatibility.detectBrowser())
  const [browserSupportError, setBrowserSupportError] = createSignal<
    string | null
  >(null)

  // New signal for mass storage consent checkbox
  const [isMassStorageConsented, setIsMassStorageConsented] =
    createSignal(false)

  createEffect(() => {
    actions.fetchImages()
    checkBrowserSupport()
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
      if (type === 'usb') {
        if (!BrowserCompatibility.isWebUSBSupported()) {
          throw new Error(`WebUSB not supported in ${browserType()}`)
        }

        const device = await navigator.usb.requestDevice({
          filters: [],
        })
        const usbWriter = new USBWriter(device)
        await usbWriter.initialize()
        setWriter(usbWriter)
        setDeviceType('usb')
      } else {
        // Only proceed if mass storage consent is given
        if (!isMassStorageConsented()) {
          throw new Error(
            'Please check the consent checkbox for mass storage device usage',
          )
        }

        if (!BrowserCompatibility.isFileSystemAccessSupported()) {
          throw new Error(
            `File System Access not supported in ${browserType()}`,
          )
        }

        const directoryHandle = await USBWriter.requestMassStorageDevice()
        if (directoryHandle) {
          setFileSystemHandle(directoryHandle)
          const info = await USBWriter.getMassStorageDeviceInfo(directoryHandle)
          setDeviceInfo(info)
          setDeviceType('mass-storage')
        }
      }
    } catch (error) {
      console.error('Device connection error:', error)
      setState('error', (error as Error).message)
    }
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
          <Show when={!writer() && !fileSystemHandle()}>
            <div class="connection-options">
              <button onClick={() => connectDevice('usb')}>
                Connect USB Device
              </button>

              <div class="mass-storage-consent">
                <label>
                  <input
                    type="checkbox"
                    checked={isMassStorageConsented()}
                    onChange={e =>
                      setIsMassStorageConsented(e.currentTarget.checked)
                    }
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

          <Show when={writer()}>
            <div class="image-selection">
              <select
                onChange={e =>
                  actions.selectImage(
                    state.images[e.currentTarget.selectedIndex - 1],
                  )
                }
                disabled={state.flashProgress.status !== 'idle'}
              >
                <option value="">Select Recovery Image</option>
                <For each={state.images}>
                  {image => <option value={image.url}>{image.name}</option>}
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
                </div>
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

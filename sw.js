/* global self ReadableStream Response */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

const map = new Map()
const streamState = new Map() // Track stream state: { controller, hasFetched, pendingClose }

self.onmessage = event => {
  if (event.data === 'ping') {
    return
  }

  const data = event.data
  const downloadUrl = data.url || self.registration.scope + Math.random() + '/' + (typeof data === 'string' ? data : data.filename)
  const port = event.ports[0]
  const metadata = new Array(4)

  metadata[1] = data
  metadata[2] = port
  metadata[3] = false

  if (event.data.readableStream) {
    metadata[0] = event.data.readableStream
  } else if (event.data.transferringReadable) {
    port.onmessage = evt => {
      port.onmessage = null
      metadata[0] = evt.data.readableStream
    }
  } else {
    metadata[0] = createStream(port, downloadUrl)
  }

  map.set(downloadUrl, metadata)
  port.postMessage({ download: downloadUrl })
}

function createStream (port, downloadUrl) {
  console.log('[SW] Creating ReadableStream for download')
  
  const state = {
    controller: null,
    hasFetched: false,
    pendingClose: false
  }
  streamState.set(downloadUrl, state)
  
  return new ReadableStream({
    start (controller) {
      state.controller = controller
      port.onmessage = ({ data }) => {
        if (data === 'end') {
          console.log('[SW] Received "end" - hasFetched:', state.hasFetched)
          if (state.hasFetched) {
            console.log('[SW] Closing stream after 500ms delay for Safari to consume')
            setTimeout(() => {
              console.log('[SW] Closing stream now')
              controller.close()
            }, 500)
          } else {
            console.log('[SW] Deferring close until fetch')
            state.pendingClose = true
          }
          return
        }

        if (data === 'abort') {
          console.log('[SW] Received "abort" - erroring stream')
          controller.error('Aborted the download')
          return
        }

        console.log('[SW] Enqueuing chunk:', data.byteLength, 'bytes')
        controller.enqueue(data)
      }
    },
    cancel (reason) {
      console.log('[SW] Stream cancelled:', reason)
      port.postMessage({ abort: true })
    }
  })
}

self.onfetch = event => {
  const url = event.request.url

  // this only works for Firefox
  if (url.endsWith('/ping')) {
    return event.respondWith(new Response('pong'))
  }

  console.log('[SW] Fetch intercepted:', url)

  const hijacke = map.get(url)

  if (!hijacke) {
    console.log('[SW] No match in map for:', url)
    return null
  }

  const [ stream, data, port ] = hijacke

  console.log('[SW] Found stream for:', url)
  map.delete(url)

  const state = streamState.get(url)
  if (state) {
    state.hasFetched = true
    console.log('[SW] Fetch happened, pendingClose:', state.pendingClose)
  }

  // Not comfortable letting any user control all headers
  // so we only copy over the length & disposition
  const responseHeaders = new Headers({
    'Content-Type': 'application/octet-stream',

    // Prevent MIME sniffing - fixes Safari adding .html extension
    'X-Content-Type-Options': 'nosniff',

    // To be on the safe side, The link can be opened in a iframe.
    // but octet-stream should stop it.
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Security-Policy': "default-src 'none'",
    'X-WebKit-CSP': "default-src 'none'",
    'X-XSS-Protection': '1; mode=block',
    'Cross-Origin-Embedder-Policy': 'require-corp'
  })

  let headers = new Headers(data.headers || {})

  if (headers.has('Content-Length')) {
    responseHeaders.set('Content-Length', headers.get('Content-Length'))
  }

  if (headers.has('Content-Disposition')) {
    // Pass through the dual-format disposition from StreamSaver.js
    responseHeaders.set('Content-Disposition', headers.get('Content-Disposition'))
  }

  // data, data.filename and size should not be used anymore
  if (data.size) {
    console.warn('Depricated')
    responseHeaders.set('Content-Length', data.size)
  }

  let fileName = typeof data === 'string' ? data : data.filename
  if (fileName) {
    console.warn('Depricated')
    // Make filename RFC5987 compatible, but also include plain filename for Safari
    const safeFileName = encodeURIComponent(fileName).replace(/['()]/g, escape).replace(/\*/g, '%2A')
    // Use both formats: plain filename for Safari, RFC5987 for others
    responseHeaders.set('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${safeFileName}`)
  }

  console.log('[SW] Responding with stream, Content-Length:', responseHeaders.get('Content-Length'))
  event.respondWith(new Response(stream, { headers: responseHeaders }))

  if (state && state.pendingClose && state.controller) {
    console.log('[SW] Fetch done and pending close - closing after delay')
    state.pendingClose = false
    setTimeout(() => {
      console.log('[SW] Closing stream after fetch + delay')
      state.controller.close()
    }, 500)
  }

  port.postMessage({ debug: 'Download started' })
}

const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

function loadStreamSaverForFallbackWrite () {
  const filePath = path.join(__dirname, '..', 'StreamSaver.js')
  const source = fs.readFileSync(filePath, 'utf8')
  let lastChannel = null

  class FakePort {
    constructor () {
      this.onmessage = null
      this.messages = []
    }

    postMessage (message) {
      this.messages.push(message)
    }

    close () {}
  }

  class FakeMessageChannel {
    constructor () {
      this.port1 = new FakePort()
      this.port2 = new FakePort()
      lastChannel = this
    }
  }

  const iframe = {
    hidden: false,
    src: '',
    loaded: true,
    name: '',
    isIframe: true,
    contentWindow: {
      postMessage () {}
    },
    addEventListener () {},
    postMessage (...args) {
      this.contentWindow.postMessage(...args)
    }
  }

  const context = {
    console,
    MessageChannel: FakeMessageChannel,
    ReadableStream,
    Response,
    Uint8Array,
    WritableStream,
    escape,
    navigator: { serviceWorker: {} },
    TransformStream: undefined,
    window: null,
    document: {
      documentElement: { style: {} },
      createElement () {
        return iframe
      },
      body: {
        appendChild () {}
      }
    },
    module: { exports: {} },
    exports: {},
    define: undefined
  }

  context.window = context
  context.HTMLElement = function HTMLElement () {}
  context.isSecureContext = true

  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'StreamSaver.js' })

  return {
    streamSaver: context.module.exports,
    getLastChannel: () => lastChannel
  }
}

test.describe('Safari fallback chunking', () => {
  test('splits large writes into smaller fallback postMessage chunks', async () => {
    const { streamSaver, getLastChannel } = loadStreamSaverForFallbackWrite()
    const fileStream = streamSaver.createWriteStream('large.bin', { size: 1024 * 1024 })
    const writer = fileStream.getWriter()
    const channel = getLastChannel()
    const largeChunk = new Uint8Array(1024 * 1024)

    channel.port1.onmessage({ data: { pull: 4 } })
    await writer.write(largeChunk)

    const dataMessages = channel.port1.messages.filter(message => message instanceof Uint8Array)

    expect(dataMessages).toHaveLength(4)
    expect(dataMessages.every(message => message.byteLength === 256 * 1024)).toBe(true)
  })
})

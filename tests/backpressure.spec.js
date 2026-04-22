const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

function loadCreateStream () {
  const swPath = path.join(__dirname, '..', 'sw.js')
  const source = fs.readFileSync(swPath, 'utf8') + '\nmodule.exports = { createStream }\n'
  const context = {
    console,
    ArrayBuffer,
    Map,
    ReadableStream,
    Response,
    Uint8Array,
    module: { exports: {} },
    exports: {},
    setTimeout: fn => {
      fn()
      return 0
    },
    self: {
      addEventListener () {},
      registration: { scope: 'https://example.test/' }
    }
  }

  vm.createContext(context)
  vm.runInContext(source, context, { filename: 'sw.js' })
  return context.module.exports.createStream
}

test.describe('Safari fallback backpressure', () => {
  test('service worker grants one numeric credit before the first chunk arrives', async () => {
    const createStream = loadCreateStream()
    const messages = []
    const port = {
      onmessage: null,
      postMessage (message) {
        messages.push(message)
      }
    }

    const stream = createStream(port, 'https://example.test/download')
    const reader = stream.getReader()

    await Promise.resolve()

    expect(messages).toEqual([{ pull: 1 }])

    const readPromise = reader.read()
    port.onmessage({ data: new Uint8Array([1, 2, 3]) })

    await expect(readPromise).resolves.toEqual({
      done: false,
      value: new Uint8Array([1, 2, 3])
    })

    await Promise.resolve()

    expect(messages).toEqual([{ pull: 1 }, { pull: 1 }])
  })
})

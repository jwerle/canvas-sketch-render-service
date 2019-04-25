const hyperdrive = require('hyperdrive')
const WebSocket = require('simple-websocket')
const mirror = require('mirror-folder')
const mkdirp = require('mkdirp')
const path = require('path')
const pify = require('pify')
const pump = require('pump')
const get = require('get-uri')
const ram = require('random-access-memory')
const fs = require('fs')

const bundle = hyperdrive(ram)

const { SKETCH_HOST = 'ws://localhost:3000' } = process.env // try ws://canvas-sketch.cafe.network

const EXAMPLES = 'https://raw.githubusercontent.com/mattdesl/canvas-sketch/master/examples/'
const [ ,,sketch = 'animated-grid' ] = process.argv
const uri = (name) => {
  if ('' === path.extname(name)) {
    name += '.js'
  }
  return [ EXAMPLES, name ].join('/')
}

bundle.ready(async () => {
  const key = bundle.key.toString('hex')
  const socket = new WebSocket(`${SKETCH_HOST}/${key}`)

  bundle.writeFile('package.json', Buffer.from(`
{
  "name": "sketch",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "author": "",
  "license": "ISC",
  "dependencies": {
    "canvas-sketch": "^0.3.0",
    "canvas-sketch-util": "^1.8.0",
    "three": "0.103.0",
    "p5": "^0.7.2"
  }
}
  `))

  await pify(pump)(
    await pify(get)(uri(sketch)),
    bundle.createWriteStream('index.js')
  )

  const stream = bundle.replicate({ live: true })

  pump(stream, socket, stream)

  stream.once('handshake', onhandshake)

  function onhandshake() {
    console.log('Handshake complete')
    const response = hyperdrive(ram, stream.remoteUserData)

    response.replicate({ stream, live: true, timeout: 30000 })
    response.download('index.html')

    response.once('update', onupdate)
    response.once('content', oncontent)
    response.once('syncing', onsyncing)
    response.once('sync', onsync)

    let syncing = false

    function onsyncing() {
      console.log('Waiting for response from server')
      syncing = true
      response.download('index.html', onsync)
    }

    function oncontent() {
      console.log('Received content feed')

      if (!syncing) {
        onsync()
      }
    }

    function onupdate() {
      console.log('Received update from server')
      console.log('Waiting for content feed')
    }

    async function onsync() {
      response.readdir('/', (err, files) => {
        if (err) {
          throw err
        }

        console.log('Did sync content from server', files)
      })

      const output = path.resolve(__dirname, 'build/')

      await pify(mkdirp)(output)

      const reader = response.createReadStream('index.html')
      const writer = fs.createWriteStream(path.resolve(output, 'index.html'))

      console.log('Writing to output directory', output);

      try {
        pump(reader, writer, onpump)
      } catch (err) {
        onpump(err)
      }
    }

    function onpump(err) {
      if (err) {
        throw err
      }

      console.log('Cleaning up')
      socket.destroy()
      console.log('Visit %s', socket.url.replace(/wss?:/, 'http:'))
    }
  }
})

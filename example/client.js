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

const dirname = path.resolve('.', 'example/sketch')
const bundle = hyperdrive(ram)

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
  const socket = new WebSocket(`ws://localhost:3000/${key}`)

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
    "p5": "^0.7.2"
  }
}
  `))

  pump(await pify(get)(uri(sketch)), bundle.createWriteStream('index.js'))

  const stream = bundle.replicate({ live: true })
  pump(stream, socket, stream).once('handshake', onhandshake)

  function onhandshake() {
    console.log('Handshake complete')
    const response = hyperdrive(ram, stream.remoteUserData, { sparse: true })

    response.replicate({ stream, live: true })
    response.on('update', onupdate)

    console.log('Waiting for response from server')
    async function onupdate() {
      const output = path.resolve(dirname, 'build/')
      await pify(mkdirp)(output)

      const reader = response.createReadStream('index.html')
      const writer = fs.createWriteStream(path.resolve(output, 'index.html'))

      console.log('Writing to output directory', output);
      pump(reader, writer, onpump)
    }

    function onpump(err) {
      if (err) {
        console.log(err);
        throw err
      }

      console.log('Cleaning up')
      socket.destroy()
      console.log('Visit http://localhost:3000/%s', key)
    }
  }
})

canvas-sketch-render-service
============================

A [HyperSource](https://github.com/jwerle/hypersource) service based
on HyperDrive that converts a
[Canvas Sketch]( https://github.com/mattdesl/canvas-sketch) project
into production bundle delivered back to you in a HyperDrive archive.

## Installation

```js
$ npm install canvas-sketch-render-service
```

or (see usage)

```sh
$ npx canvas-sketch-render-service [options]
```

## Usage

**canvas-sketch-render-service** can be used in various ways. The
service can be started by running the `canvas-sketch-render-service`
command with a few arguments or by using the module directly to create
and run your own server.

### Command Line

```
usage: canvas-sketch-render-service [-hDV] [options]

where options can be:

  -r, --registry <path>   Path to HyperDrive registry
  -d, --data <path>       Path to where temporary data cache
  -p, --port <port>       Server port to listen on
  -H, --host <host>       Server host to listen on
  -D, --debug             Enable debug output
  -h, --help              Show this message
  -V, --version           Show program version

```

Start a server running on port `3000` by running:

```sh
$ canvas-sketch-render-service --port 3000
```

By default the command line program will create and access a registry at
`./canvas-sketch-registry` if one is not supplied. The path should point
to a [HyperDrive](https://github.com/mafintosh/hyperdrive) instance
where the `key` and `secret_key` files are accessible. If you need to
supply your own registry where the keys are not living along the SLEEP
files, then you will need to consume the module.

Set the path to a HyperDrive instance

```sh
$ canvas-sketch-render-service --port 3000 --registry data
Using registry at /home/werle/repos/canvas-sketch-render-service/data
Using TMPDIR at /tmp
CanvasSketch render server listening on ws://127.0.0.1:3000
```

### Module

The server can be started programmatically by using the module code
directly.

```js
const { createServer } = require('canvas-sketch-render-service')
const hyperdrive = require('hyperdrive')
const ram = require('random-access-memory')

const registry = hyperdrive('/path/to/drive', getHyperDriveOptions())
const server = createServer({ registry })

server.listen(3000, (err) => {
  console.log(err);
  console.log('listening on', server.address());
})
```

## API

### `server = createServer(opts)`

Create a new `canvas-sketch-render-service` server where `opts` can be

```js
{
  registry: Object, // A HyperDrive instance that will be the registry
  server: Object, // An optional HTTP server for the WebSocket server
  tmpdir: String, // Path to a temporary data cache directory
}
```

## Client API

Users can submit a new sketch to be built by opening up a WebSocket to
`/:key` where `:key` is a hex encoded 64 character long string that
represents the public key of the HyperDrive archive that contains the
assets.

```js
const key = drive.key.toString('hex')
const socket = new WebSocket(`ws://your-domain.com/${key}`)
```

The socket connection should be a pure
[hypercore-protocol](https://github.com/mafintosh/hypercore-protocol)
replication stream. The client should replicate the HyperDrive
archive associated with the public key in the URI.

```js
stream.pipe(socket).pipe(stream)
```

The `'handshake'` event indicates that the service has established a
channel and provides a response key to read output from the service. The
client should replicate the response archive from the server. This has
the final built sketch!

```js
stream.on('handshake', () => {
  const response = hyperdrive(ram, stream.remoteUserData)
  response.replicate({ stream, live: true })
})
```

The server should send the built asset to the response archive. The
client can listen for the `'update'` event which should indicate the
server has sent the built sketch.

```js
response.on('update', () => {
  response.readFile('index.html', (err, buf) => {
    console.log(buf.toString() // '<!doctype html><html lang=en><meta char ...'
  })
})
```

## Example

Below is a simple example of an in memory registry and
`canvas-sketch-render-service` server.

### Server

```js
const { createServer } = require('canvas-sketch-render-service')
const hyperdrive = require('hyperdrive')
const ram = require('random-access-memory')

const registry = hyperdrive(ram)
const server = createServer({ registry })

registry.ready(() => {
  registry.writeFile('dat.json', JSON.stringify({
    title: 'A Canvas Sketch Rendering Service',
    description: 'Try me out',
  }))
})

server.listen(3000, (err) => {
  console.log(err);
  console.log('listening on', server.address());
})
```

### Client

The client example bundles a sketch and sends it to the server. The
response is then written to disk.

```js
const hyperdrive = require('hyperdrive')
const WebSocket = require('simple-websocket')
const mkdirp = require('mkdirp')
const pify = require('pify')
const pump = require('pump')
const ram = require('random-access-memory')
const fs = require('fs')

const bundle = hyperdrive(ram)

bundle.ready(async () => {
  const key = bundle.key.toString('hex')
  const socket = new WebSocket(`ws://localhost:3000/${key}`)

  bundle.writeFile('package.json', Buffer.from(`
    {
      "name": "my-sample-sketch",
      "version": "1.0.0",
      "description": "",
      "main": "index.js",
      "author": "",
      "license": "ISC",
      "dependencies": {
        "canvas-sketch": "^0.3.0",
        "canvas-sketch-util": "^1.8.0",
      }
    }
  `))

  bundle.writeFile('index.js', Buffer.from(`
    const canvasSketch = require('canvas-sketch');

    // Sketch parameters
    const settings = {
      dimensions: 'a4',
      pixelsPerInch: 300,
      units: 'in'
    };

    // Artwork function
    const sketch = () => {
      return ({ context, width, height }) => {
        // Margin in inches
        const margin = 1 / 4;

        // Off-white background
        context.fillStyle = 'hsl(0, 0%, 98%)';
        context.fillRect(0, 0, width, height);

        // Gradient foreground
        const fill = context.createLinearGradient(0, 0, width, height);
        fill.addColorStop(0, 'cyan');
        fill.addColorStop(1, 'orange');

        // Fill rectangle
        context.fillStyle = fill;
        context.fillRect(margin, margin, width - margin * 2, height - margin * 2);
      };
    };

    // Start the sketch
    canvasSketch(sketch, settings);
  `)

  const stream = bundle.replicate({ live: true }).once('handshake', onhandshake)
  pump(stream, socket, stream)

  function onhandshake() {
    console.log('Handshake complete')
    const response = hyperdrive(ram, stream.remoteUserData, { sparse: true })

    response.replicate({ stream, live: true })
    response.on('update', onupdate)

    console.log('Waiting for response from server')
    async function onupdate() {
      const output = path.resolve(__dirname, 'build/')
      await pify(mkdirp)(output)

      const reader = response.createReadStream('index.html')
      const writer = fs.createWriteStream(path.resolve(output, 'index.html'))

      pump(reader, writer)
    }
  }
})
```

## Browser Preview

The `canvas-sketch-render-service` server also runs
[hyperdrive-http](https://github.com/datproject/hyperdrive-http)
middleware over the supplied registry. All submissions are stored in the
registry indexed by their public key.

Below is an example of an archive made available over HTTP:

```
http://localhost:3000/a9143642ef9afeb7b414af89a183f779c520417f006ef5f623d42040bb3ceeda
```

## License

MIT


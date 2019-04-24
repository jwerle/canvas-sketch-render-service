const hyperdriveOverHTTP = require('hyperdrive-http')
const hyperdrive = require('hyperdrive')
const { exec } = require('child_process')
const TEMPDIR = require('temp-dir')
const mirror = require('mirror-folder')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const debug = require('debug')('canvas-sketch-render-service')
const pify = require('pify')
const http = require('http')
const path = require('path')
const pump = require('pump')
const ram = require('random-access-memory')
const ncc = require('@zeit/ncc')
const hs = require('hypersource')
const fs = require('fs')

function createServer(opts) {
  const { registry } = opts
  const httpServer = opts.server || http.createServer()
  const tmpdir = opts.tmpdir || TEMPDIR
  const server = hs.createServer({ server: httpServer })

  httpServer.on('request', hyperdriveOverHTTP(registry))
  server.on('request', onrequest)

  return Object.assign(server, { registry, http: httpServer })

  function onrequest(req, res) {
    const response = hyperdrive(ram, res.key, { secretKey: res.secretKey })
    const bundle = hyperdrive(ram, req.key, { sparse: true })

    bundle.replicate(req)

    bundle.on('update', onupdate)

    async function onupdate() {
      const dirname = path.join(tmpdir, 'canvas-sketch', req.key.toString('hex'))

      try {
        await pify(mkdirp)(dirname)
        await pify(mirror)({ fs: bundle, name: '/' }, dirname)
      } catch (err ) {
        debug(err)
        server.emit('error', err)
        res.destroy()
        return
      }

      let main = null

      try {
        const filename = path.resolve(dirname, 'package.json')
        await pify(fs.access)(filename)

        const json = require(filename)

        if (json.main) {
          await pify(fs.access)(path.resolve(dirname, json.main))
          main = path.resolve(dirname, json.main)
        }
      } catch (err) {
        debug(err)
      }

      if (!main) {
        try {
          const filename = path.resolve(dirname, 'index.js')
          await pify(fs.access)(filename)
          main = filename
        } catch (err) {
          debug(err)
        }
      }

      if (!main) {
        try {
          const filename = path.resolve(dirname, 'main.js')
          await pify(fs.access)(filename)
          main = filename
        } catch (err) {
          debug(err)
        }
      }

      if (!main) {
        const files = await pify(fs.readdir)(dirname)
        if (1 === files.length) {
          const filename = path.resolve(dirname, files[0])
          const stat = await pify(fs.stat)(filename)
          if (stat.isFile()) {
            main = filename
          }
        }

        if (!main) {
          for (const file of files) {
            if ('.js' === path.extname(file)) {
              main = path.resolve(dirname, file)
              break
            }
          }
        }
      }

      try {
        const command =  [
          'npm',
          'install',
        ].join(' ')

        await pify(exec)(command, { cwd: dirname })
      } catch (err) {
        debug(err)
        return res.destroy(err)
      }

      try {
        const build = await ncc(main)

        await pify(fs.writeFile)(
          path.resolve(dirname, '_build.js'),
          Buffer.from(build.code))
      } catch (err) {
        debug(err)
        return res.destroy(err)
      }

      try {
        const command =  [
          require.resolve('canvas-sketch-cli'),
          path.resolve(dirname, '_build.js'),
          '--build',
          '--inline',
          '--name _index'
        ].join(' ')

        await pify(exec)(command, { cwd: dirname })
      } catch (err) {
        debug(err)
        return res.destroy(err)
      }

      try {
        const writer = response.createWriteStream('index.html')
        const reader = () => {
          return fs.createReadStream(path.resolve(dirname, '_index.html'))
        }

        const record = registry.createWriteStream(
          path.join('/', req.key.toString('hex'), 'index.html'))

        const name = `/sketch/${req.key.toString('hex')}`

        registry.writeFile(name, req.key, (err) => {
          if (err) {
            debug(err)
          }
        })

        await pify(pump)(reader(), writer)
        await pify(pump)(reader(), record)
        await pify(rimraf)(dirname)

        response.replicate(req)
      } catch (err) {
        debug(err)
        return res.destroy(err)
      }
    }
  }
}

module.exports = {
  createServer
}

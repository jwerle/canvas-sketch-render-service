const { createServer } = require('..')
const hyperdrive = require('hyperdrive')
const ram = require('random-access-memory')
const pkg = require('../package.json')

const registry = hyperdrive(ram)
const server = createServer({ registry })

registry.ready(() => {
  registry.writeFile('dat.json', JSON.stringify({
    title: pkg.name,
    description: pkg.description,
  }))
})

server.listen(3000, (err) => {
  console.log(err);
  console.log('listening on', server.address());
})

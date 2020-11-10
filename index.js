const { Header } = require('hypertrie/lib/messages')
const SDK = require('dat-sdk')
const { once } = require('events')
const dft = require('diff-file-tree')
const crypto = require('crypto')

const DEFAULT_SYNC_TIME = 5000

module.exports = { sync, create }

async function create ({
  seed = crypto.randomBytes(32)
} = {}) {
  const { Hypercore, Hyperdrive, close } = await sdkFromSeed(seed)

  const metadata = Hypercore('metadata')
  const content = Hypercore('content')

  await Promise.all([
    metadata.ready(),
    content.ready()
  ])

  const url = `hyper://${metadata.key.toString('hex')}`

  console.log('Seed:')
  console.log(seed.toString('hex'))
  console.log('URL:')
  console.log(url)

  await metadata.append(Header.encode({
    type: 'hypertrie',
    metadata: content.key,
    subtype: 'hyperdrive'
  }))

  console.log('Initializing Hyperdrive')

  const drive = Hyperdrive(metadata.key)

  await drive.ready()

  const keySlice = metadata.key.slice(0, 4).toString('hex')
  const indexJSON = `
{
  "title": "Hyperdrive-Publisher ${keySlice}"
}
`
  await drive.writeFile('/index.json', indexJSON)

  console.log('Please add this URL to a pinning service like dat-store to continue')

  metadata.on('peer-open', (peer) => {
    const { remoteAddress, remoteType, remotePublicKey } = peer

    console.log('Connected', { remoteAddress, remoteType, remotePublicKey })
  })

  let hasUploaded = false

  metadata.on('upload', () => {
    hasUploaded = true
  })

  await once(metadata, 'peer-open')

  console.log('Waiting to sync metadata')

  if (!hasUploaded) {
    await once(metadata, 'upload')
  }

  await delay(2000)

  console.log('Synced')

  console.log('You can sync a folder with:')
  console.log(`hyperdrive-publisher sync ${seed.toString('hex')}`)

  await close()
}

async function sync ({
  seed,
  syncTime = DEFAULT_SYNC_TIME,
  fsPath = './',
  drivePath = '/'
}) {
  const { Hyperdrive, Hypercore, close } = await sdkFromSeed(seed)

  const metadata = Hypercore('metadata', { sparse: true, eagerUpdate: true })
  const content = Hypercore('content', { sparse: true, eagerUpdate: true })

  await Promise.all([
    metadata.ready(),
    content.ready()
  ])

  console.log('Starting sync')
  console.log(`hyper://${metadata.key.toString('hex')}`)

  console.log('Listening for peers')

  // Need to set
  metadata.setDownloading(true)
  content.setDownloading(true)

  const [peer] = await once(metadata, 'peer-open')

  console.log('Peer has header', peer.remoteBitfield.get(0))

  await delay(2000)

  const { remoteAddress, remoteType, remotePublicKey } = peer

  console.log('Connected', { remoteAddress, remoteType, remotePublicKey })

  console.log('Waiting for update', metadata.length)

  try {
    await metadata.update({ ifAvailable: true, minLength: 2 })
  } catch {
    console.log('Unable to get update')
  }

  try {
    await metadata.head()
  } catch {
    console.log('Unable to load latest block')

    console.log('Initializing core')

    await metadata.append(Header.encode({
      type: 'hypertrie',
      metadata: content.key,
      subtype: 'hyperdrive'
    }))
  }

  console.log('Initializing Hyperdrive')

  const drive = Hyperdrive(metadata.key)

  await drive.ready()

  console.log('Finding changed files')

  const source = fsPath
  const dest = { fs: drive, path: drivePath }

  const diff = await dft.diff(source, dest, {
    // In case the folder's mtime is different from a git clone or something
    compareContent: true
  })

  console.log('Diff:', diff)

  console.log('Loading into drive')

  let hasUploaded = false

  metadata.on('upload', () => {
    hasUploaded = true
  })

  await dft.applyRight(source, dest, diff)

  console.log('Waiting to sync with peers')

  if (!hasUploaded) {
    console.log('Waiting for intial upload')
    await once(metadata, 'upload')
  }

  await delay(syncTime)

  console.log('Done')

  await close()
}

async function sdkFromSeed (initialSeed) {
  const seed = (typeof initialSeed === 'string') ? Buffer.from(initialSeed, 'hex') : initialSeed
  return SDK({
    persist: false,
    corestoreOpts: {
      masterKey: seed
    }
  })
}

async function delay (time) {
  await new Promise((resolve) => setTimeout(resolve, time))
}

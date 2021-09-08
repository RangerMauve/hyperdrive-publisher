const { Header } = require('hypertrie/lib/messages')
const SDK = require('hyper-sdk')
const { once } = require('events')
const dft = require('diff-file-tree')
const crypto = require('crypto')
const bitfield = require('fast-bitfield')

module.exports = { sync, create, getURL }

async function create ({
  seed = crypto.randomBytes(32),
  verbose = false,
  title = ''
} = {}) {
  const { Hypercore, Hyperdrive, close } = await sdkFromSeed(seed)
  try {
    const metadata = Hypercore('metadata')
    const content = Hypercore('content')

    await Promise.all([
      metadata.ready(),
      content.ready()
    ])

    const tracker = trackAckBitfield(content)

    const url = `hyper://${metadata.key.toString('hex')}`

    if (verbose) {
      console.log('Seed:')
      console.log(seed.toString('hex'))
      console.log('URL:')
      console.log(url)
    }

    await metadata.append(Header.encode({
      type: 'hypertrie',
      metadata: content.key,
      subtype: 'hyperdrive'
    }))

    if (verbose) {
      console.log('Initializing Hyperdrive')
    }

    const drive = Hyperdrive(metadata.key)

    await drive.ready()

    const keySlice = metadata.key.slice(0, 4).toString('hex')

    const driveTitle = title || `Hyperdrive-Publisher ${keySlice}`

    const indexJSON = JSON.stringify({
      title: driveTitle
    }, null, '\t')

    await drive.writeFile('/index.json', indexJSON)

    if (verbose) {
      console.log('Please add this URL to a pinning service like dat-store to continue')
      metadata.on('peer-open', (peer) => {
        const { remoteAddress, remoteType, remotePublicKey } = peer
        console.log('Connected', { remoteAddress, remoteType, remotePublicKey })
      })
    }

    if (!metadata.peers.length) {
      await once(metadata, 'peer-open')
    }

    const stats = await getFileStats(drive, ['/index.json'])

    if (verbose) {
      console.log('Waiting to sync metadata')
    }

    await waitForFullAck(content, tracker.ackBitfield, stats)

    tracker.off()

    if (verbose) {
      console.log('Synced')

      console.log('You can sync a folder with:')
      console.log(`hyperdrive-publisher sync ${seed.toString('hex')}`)
    }

    return { seed, url }
  } finally {
    await close()
  }
}

async function sync ({
  seed,
  fsPath = './',
  drivePath = '/',
  verbose = false
}) {
  if (!seed) throw new TypeError('Must specify seed')
  const { Hyperdrive, Hypercore, close } = await sdkFromSeed(seed)

  try {
    const metadata = Hypercore('metadata', { sparse: true, eagerUpdate: true })
    const content = Hypercore('content', { sparse: true, eagerUpdate: true })

    await Promise.all([
      metadata.ready(),
      content.ready()
    ])

    const tracker = trackAckBitfield(content)

    const url = `hyper://${metadata.key.toString('hex')}`

    if (verbose) {
      console.log('Starting sync')
      console.log(url)

      console.log('Listening for peers')
    }

    // Need to set
    metadata.setDownloading(true)
    content.setDownloading(true)

    const [peer] = await once(metadata, 'peer-open')

    await delay(2000)

    if (verbose) {
      console.log('Peer has header', peer.remoteBitfield.get(0))
    }

    const { remoteAddress, remoteType, remotePublicKey } = peer
    if (verbose) {
      console.log('Connected', { remoteAddress, remoteType, remotePublicKey })

      console.log('Waiting for update', metadata.length)
    }

    try {
      await metadata.update({ ifAvailable: true, minLength: 2 })
    } catch {
      throw new Error('Unable to get Update')
    }

    try {
      await metadata.head()
    } catch {
      throw new Error('Unable to get latest block, did you add the URL to a backup peer?')
    }

    if (verbose) {
      console.log('Initializing Hyperdrive')
    }

    const drive = Hyperdrive(metadata.key)

    await drive.ready()

    if (verbose) {
      console.log('Finding changed files')
    }

    const source = fsPath
    const dest = { fs: drive, path: drivePath }

    const diff = await dft.diff(source, dest, {
    // In case the folder's mtime is different from a git clone or something
      compareContent: true
    })

    if (diff.length) {
      if (verbose) {
        console.log('Diff:', diff)

        console.log('Loading into drive')
      }

      await dft.applyRight(source, dest, diff)

      const added = diff
        .filter(({ change }) => ((change === 'add') || (change === 'mod')))
        .map(({ path }) => path)

      if (verbose) {
        console.log('Loaded into drive')
        console.log(`Waiting to sync ${added.length} files`)
      }

      const stats = await getFileStats(drive, added)

      await waitForFullAck(content, tracker.ackBitfield, stats)

      tracker.off()
    } else {
      if (verbose) {
        console.log('No new changes detected', { diff })
      }
    }

    if (verbose) {
      console.log('Done')
    }

    return { url, diff }
  } finally {
    await close()
  }
}

async function getURL ({ seed, verbose }) {
  if (!seed) throw new TypeError('Must specify seed')
  const { Hypercore, close } = await sdkFromSeed(seed)
  try {
    const metadata = Hypercore('metadata')

    await metadata.ready()

    const url = `hyper://${metadata.key.toString('hex')}`

    if (verbose) {
      console.log(url)
    }

    return { url }
  } finally {
    await close()
  }
}

async function sdkFromSeed (initialSeed) {
  const seed = (typeof initialSeed === 'string') ? Buffer.from(initialSeed, 'hex') : initialSeed
  return SDK({
    persist: false,
    corestoreOpts: {
      masterKey: seed,
      ack: true
    }
  })
}

/**
 * waitForFullAck
 *
 * @description check if there is at least one peer fully synchronized (up to date) with our drive
 * @async
 * @param {Object} contentFeed hypercore content feed
 * @param {Bitfield} ackBitfield a bitfield representing the blcks that have been acked
 * @param {Array} fileList the files to check against.
 */
async function waitForFullAck (contentFeed, ackBitfield, fileList) {
  if (!contentFeed) {
    throw new Error('content feed is required')
  }
  const deferred = makeDeferred()
  contentFeed.on('peer-ack', checkSync)

  function checkSync () {
    try {
      // TODO: DO something fancy with bitfields
      for (const { start, end } of fileList) {
        for (let i = start; i < end; i++) {
          // Missing block, should continue
          if (!ackBitfield.has(i)) return
        }
      }

      // Each file block must be in the bitfield!
      deferred.resolve()
    } catch (e) {
      deferred.reject(e)
    }
  }
  try {
    // note: consider add a timeout to cancel the wait
    await deferred.promise
  } finally {
    contentFeed.removeListener('peer-ack', checkSync)
  }
}

/**
 * getFileStats.
 *
 * @description Iterates over each file of the drive tracking start and end of each item
 * @async
 * @param {Object} drive Hyperdrive instance
 * @return {Array} An array containing [<{file:String, start:Number, end:Number}>]
 */
async function getFileStats (drive, files = []) {
  const stats = []
  for (const file of files) {
    const stat = await drive.stat(file)
    stats.push({
      file,
      start: stat.offset,
      end: stat.offset + stat.blocks
    })
  }

  return stats
}

function trackAckBitfield (core) {
  const ackBitfield = bitfield()

  core.on('peer-ack', onAck)

  function onAck (peer, have) {
    if (have.ack) {
      // TODO Account for when `have.bitfield` isn't null
      const end = have.start + have.length
      for (let i = have.start; i < end; i++) {
        ackBitfield.set(i, true)
      }
      // TODO: Fill seems to be causing errors and I'm not sure why
      // ackBitfield.fill(true, have.start, have.start + have.length)
    } else {
      // This isn't an ack event
    }
  }
  function off () {
    core.removeListener('peer-ack', onAck)
  }

  return {
    ackBitfield,
    off
  }
}

function makeDeferred () {
  let resolve = null
  let reject = null
  // eslint-disable-next-line
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })

  return { promise, resolve, reject }
}

async function delay (time) {
  await new Promise((resolve) => setTimeout(resolve, time))
}

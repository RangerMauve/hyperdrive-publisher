const { Header } = require('hypertrie/lib/messages')
const SDK = require('dat-sdk')
const { once } = require('events')
const dft = require('diff-file-tree')
const crypto = require('crypto')
const debounce = require('lodash.debounce')
const bitfield = require('fast-bitfield')

const DEFAULT_SYNC_TIME = 5000

module.exports = { sync, create, getURL, getFileRanges, checkPeersSync }

async function create ({
  seed = crypto.randomBytes(32),
  verbose = false
} = {}) {
  const { Hypercore, Hyperdrive, close } = await sdkFromSeed(seed)
  try {
    const metadata = Hypercore('metadata')
    const content = Hypercore('content')

    await Promise.all([
      metadata.ready(),
      content.ready()
    ])

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
    const indexJSON = `
{
  "title": "Hyperdrive-Publisher ${keySlice}"
}
`

    await drive.writeFile('/index.json', indexJSON)

    if (verbose) {
      console.log('Please add this URL to a pinning service like dat-store to continue')
      metadata.on('peer-open', (peer) => {
        const { remoteAddress, remoteType, remotePublicKey } = peer
        console.log('Connected', { remoteAddress, remoteType, remotePublicKey })
      })
    }

    await once(metadata, 'peer-open')

    // bitfield-like structure. Used to known start and ends of all the hyperdrive contents.
    // Later we can use it to compare what other peers have.
    const [, localBitfield, visited] = await getFileRanges(drive)

    await peersFullAck(localBitfield, visited)

    // await checkPeersSync(content, stats)
    /*
    if (verbose) {
      console.log('Waiting to sync metadata')
    }
    if (!hasUploaded) {
      await once(metadata, 'upload')
    }

    await delay(2000)
    */

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

/**
 * peersFullAck
 *
 * @description check if there is at least one peer fully synchronized (up to date) with our drive
 * @async
 * @param {Object} contentFeed hypercore content feed
 * @param {Bitfield} localBitfield a copy of the local contents bitfield
 * @param {Map} visitedStats every time a new peer-ack arrives, if the local bitfield hast the value, we mark the visitedStats removing the entry from the map.
 */
async function peersFullAck (contentFeed, localBitfield, visitedStats) {
  if (!contentFeed) {
    throw new Error('content feed is required')
  }

  // note: consider add a timeout to cancel the wait
  const result = {}
  result.promise = new Promise((resolve, reject) => {
    result.resolve = () => {
      contentFeed.off('peer-ack', checkSync)
      resolve()
    }

    result.reject = err => {
      contentFeed.off('peer-ack', checkSync)
      reject(err)
    }
  })

  function checkSync (_, have) {
    if (localBitfield.get(have.start)) {
      // mark visited
      visitedStats.delete(have.start)
      if (visitedStats.size === 0) {
        return result.resolve()
      }
    } else {
      // this can be seen as an error or just a warning...
      console.warn('have is not found in local bitfield. local bitfield out of sync?', { have })
    }
  }

  return result.promise
}

/**
 * getFileRanges.
 *
 * @description Iterates over each file of the drive tracking start and end of each item
 * @async
 * @param {Object} drive Hyperdrive instance
 * @return {Array} An array containing [<{file:String, start:Number, end:Number, peersHave: Boolean}>]
 */
async function getFileRanges (drive, prevStats) {
  const list = await drive.stats('/')
  const replicatedStats = prevStats || new Map()
  const localBitfield = bitfield()

  for (const [file] of list) {
    if (replicatedStats.has(file)) {
      // skip to next file
      continue
    }

    const [fileStat] = await drive.stat(file)

    replicatedStats.set(file, {
      start: fileStat.offset,
      end: fileStat.blocks,
      replicated: prevStats.false
    })

    localBitfield.fill(true, fileStat.offset, fileStat.blocks)
  }

  return [replicatedStats, localBitfield, new Map(replicatedStats)]
}

async function sync ({
  seed,
  syncTime = DEFAULT_SYNC_TIME,
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

      let hasUploaded = false

      metadata.on('upload', () => {
        hasUploaded = true
      })

      await dft.applyRight(source, dest, diff)

      console.log('Waiting to sync with peers')

      if (!hasUploaded) {
        if (verbose) {
          console.log('Waiting for intial upload')
        }
        await once(metadata, 'upload')
      }

      if (verbose) {
        console.log(`Waiting for ${syncTime}ms to sync`)
      }

      await delay(syncTime)
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

async function delay (time) {
  await new Promise((resolve) => setTimeout(resolve, time))
}

const { Header } = require('hypertrie/lib/messages')
const SDK = require('dat-sdk')
const { once } = require('events')
const dft = require('diff-file-tree')
const crypto = require('crypto')
const debounce = require('lodash.debounce')

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

    const stats = await getFileRanges(drive)

    await checkPeersSync(content, stats)
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
 * checkPeersSync.
 *
 * @description check if there is at least one peer fully synchronized (up to date) with our drive
 * @async
 * @param {Object} contentFeed hypercore content feed
 * @param {Array} stats array containing { file: String, start: Number, end: Number}. start === stat.offset and end === blocks
 * @param {[Number]} wait a number in miliseconds to use as a function timeout. Defaults to 120000 (2 minutes). OPTIONAL
 */
function checkPeersSync (contentFeed, stats, wait = 120000) {
  if (!contentFeed) {
    throw new Error('content feed is required')
  }

  const result = {}
  result.promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      result.reject(new Error(`timeout exceded: ${wait}ms`))
    }, wait)

    result.resolve = () => {
      contentFeed.off('upload', checkSync)
      clearTimeout(timer)
      resolve()
    }

    result.reject = err => {
      contentFeed.off('upload', checkSync)
      clearTimeout(timer)
      reject(err)
    }
  })

  const checkSync = debounce(() => {
    console.log({ peers: contentFeed.peers })
    console.log({ stats })

    for (const peer of contentFeed.peers) {
      // Ignore peers without remote bitfields
      if (!peer.remoteBitfield) continue

      // iterate over ranges
      let haveAll = true

      for (const stat of stats) {
        for (let idx = stat.start; idx <= stat.end; idx++) {
          if (idx === 0) continue
          if (!peer.remoteBitfield.get(idx)) {
            haveAll = false
            return
          }
        }

        if (!haveAll) {
          // check next peer
          break
        }
      }

      if (haveAll) {
        // content synced with at least one peer
        return result.resolve()
      }
    }
  }, 150)

  checkSync()
  contentFeed.on('upload', checkSync)

  return result.promise
}

/**
 * getFileRanges.
 *
 * @description Iterates over each file of the drive tracking start and end of each item
 * @async
 * @param {Object} drive Hyperdrive instance
 * @return {Array} An array containing [<{file:String, start:Number, end:Number}>]
 */
async function getFileRanges (drive) {
  const list = await drive.stats('/')
  const driveStats = []

  for (const [file] of list) {
    const [fileStat] = await drive.stat(file)
    driveStats.push({
      file: file,
      start: fileStat.offset,
      end: fileStat.blocks
    })
  }

  return driveStats
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
      masterKey: seed
    }
  })
}

async function delay (time) {
  await new Promise((resolve) => setTimeout(resolve, time))
}

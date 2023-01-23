const tape = require('tape')
const crypto = require('crypto')
const path = require('path')

const { sync, create, getURL } = require('./')

const SDK = require('hyper-sdk')

tape('Create an archive', async (t) => {
  const { seed, url, drive, cleanup } = await setup()

  try {
    const title = 'Testing'

    const { url: gotURL } = await create({ seed, title })

    t.equal(gotURL, url, 'create generated expected URL')

    const files = await drive.readdir('/')

    t.deepEqual(files, ['index.json'], 'Generated index file')

    const content = await drive.readFile('index.json', 'utf8')

    t.ok(content, 'Able to load index.json from seeder')

    const parsed = JSON.parse(content)

    t.equal(parsed.title, title, 'Title got used')
  } finally {
    await cleanup()
  }
})

tape('Create and sync', async (t) => {
  const { seed, url, drive, cleanup } = await setup()

  try {
    await create({ seed })

    const fsPath = path.join(__dirname, 'example')

    const { diff, url: gotURL } = await sync({ seed, fsPath })

    t.equal(gotURL, url, 'create generated expected URL')

    const files = await drive.readdir('/')

    t.deepEqual(files.sort(), ['example.txt', 'index.html', 'index.json'], 'Uploaded expected files')

    t.equal(diff.length, 3, 'Found diffs')
  } finally {
    await cleanup()
  }
})

tape('Sync and tag', async (t) => {
  const { seed, drive, cleanup } = await setup()

  try {
    await create({ seed })

    const fsPath = path.join(__dirname, 'example')

    const tag = 'v1.0.0'

    await sync({ seed, fsPath, tag })

    const tags = await drive.getAllTags()

    t.ok(tags.has(tag), 'Tag got created')
  } finally {
    await cleanup()
  }
})

tape('Ignore during sync', async (t) => {
  const { seed, drive, cleanup } = await setup()

  try {
    await create({ seed })

    const fsPath = path.join(__dirname, 'example')

    const ignore = ['index.html']

    const { diff } = await sync({ seed, fsPath, ignore })

    const files = await drive.readdir('/')

    t.deepEqual(files.sort(), ['example.txt', 'index.json'], 'Uploaded expected files')

    t.equal(diff.length, 2, 'Found diffs')
  } finally {
    await cleanup()
  }
})

async function setup () {
  const { Hyperdrive, close } = await SDK({ persist: false })
  try {
    const seed = getSeed()

    const { url } = await getURL({ seed })

    const drive = Hyperdrive(url, {
      sparse: false,
      sparseMetadata: false
    })

    return {
      seed,
      url,
      drive,
      cleanup: close
    }
  } catch (e) {
    await close()
    throw e
  }
}

function getSeed () {
  return crypto.randomBytes(32)
}

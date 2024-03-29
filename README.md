# hyperdrive-publisher
CLI for publishing a new change to your hyperdrive and syncing it with remote peers

## How it works

- Generates a seed for the hyperdrive
- Uses the seed to generate hypercores for Hyperdrive and set up metadata
- Whenever you want to sync your drive, you can pass in the secret and a folder path
- It'll then sync with a remote peer (probably a dat-store instance)

## How to use it

### Setup:

- `npm i -g hyperdrive-publisher`
- Set up a pinning service like [dat-store](https://github.com/datproject/dat-store) or [hyperdrive-daemon](https://github.com/hypercore-protocol/hyperdrive-daemon)

### Creation

- Run `hyperdrive-publisher create`
- Add the URL to your `dat-store` instance or whatever backups you use
- Wait for the script to upload data to your backup
- Save the Seed somewhere to reuse later when you publish
- Make sure you don't lose the seed because you cannot recover it

### Sync

- Whenever you want to update your hyperdrive
- Run `hyperdrive-publisher sync <seed> [fsPath] [drivePath]`
- E.g. `hyperdrive-publisher sync f1c681ad2caf09aac2d38adc6a1cc213e7880a9bdfbbc94d81537f3768bc9728 ./example /somewhere`
- This will:
	- Wait to connect to a peer for your drive
	- Make sure the metadata has been synced with a peer
	- Sync data from the `./public` folder on your filesystem to the `/website` folder in the hyperdrive
  - Optionally create a `tag`
	- Count every block that got uploaded to a remote peer, wait for all the new files to have been uploaded
	- Exit

### Get URL

- In case you forget your URL you can re-generate it from the seed
- Run `hyperdrive-publisher getURL <seed>`
- E.g. `hyperdrive-publisher getURL f1c681ad2caf09aac2d38adc6a1cc213e7880a9bdfbbc94d81537f3768bc9728`

## JavaScript API

`npm i --save hyperdrive-publisher`

```JavaScript
const {create, sync, getURL} = require('hyperdrive-publisher')

// You can generate a seed yourself
const seed = require('crypto').randomBytes(32)

// Before creating or syncing, make sure to add this URL to a dat-store
const url = await getURL({seed})

// You can do this via the dat-storage-client API
// https://github.com/RangerMauve/dat-storage-client
const DatStorageClient = require('dat-storage-client')
const client = new DatStorageClient(SERVICE_URL)
await client.login(username, password)
await client.add({url})

// This is how you create a hyperdrive
// The URL gets returned in case you need it
const {url} = await create({seed})

// You can run a sync programmatically, too
// The returned diff is an array of changes 
const {diff, url} = await sync({
  seed,
  fsPath: './',
  drivePath: '/'
})
```

### `const {url} = await getURL({seed, verbose=false})`

- `seed` must be provided and should be a Buffer with 32 bytes.
- `url` will be the `hyper://` URL of the hyperdrive that got generated for this seed
- `verbose` controls whether there will be console output. By default it's false so that you don't have junk in your logs

### `const {seed, url} = await create({seed = crypto.randomBytes(32), title, verbose=false})`

Creates a Hyperdrive and waits for the initial sync with a peer.

You'll need to use `getURL` and add it to a `dat-store` beforehand otherwise it'll get stuck on waiting to get a peer.

- `seed` is the seed used to generate the Hyperdrive, this will be auto-generated if you don't provide it, the seed will also be in the return value so you can save it
- `url` will be the `hyper://` URL of the hyperdrive that got generated for this seed
- `title` will be set to the title inside the generated `index.json` which is used by tools like dat-store to show human readable titles for dirves.
- `verbose` controls whether there will be console output. By default it's false so that you don't have junk in your logs

### `const {diff, url} = await sync({seed, fsPath='./', drivePath='/', tag=undefined, ignore=['.git/**'], verbose=false})`

- `seed` is the seed used to generate the Hyperdrive, ths must be provided.
- `url` will be the `hyper://` URL of the hyperdrive that got generated for this seed
- `fsPath` is the file path (relative to the current working directory) to sync files from
- `drivePath` is the folder inside the hyperdrive you'd like files to be synced to
- `tag` is an optional name to tag the drive with so that you can get back to it in the history.
- `ignore` is an optional array of strings for files and folders to ignore. Uses [anymatch](https://www.npmjs.com/package/anymatch) syntax.
- `verbose` controls whether there will be console output. By default it's false so that you don't have junk in your logs

## Use with Github Actions

You can place [./publish.yml] in your `.github/workflows/` folder and add your seed as a secret key called `PUBLISHER_KEY` in order to publish changes on every push.

Make sure you have the appropriate branch set in the config, the default is `default`.


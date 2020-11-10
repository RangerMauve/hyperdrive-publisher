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

### Sync

- Whenever you want to update your hyperdrive
- Run `hyperdrive-publisher sync <seed> [fsPath] [drivePath]`
- E.g. `hyperdrive-publisher sync AKJSHDAKJSDHAKSHD ./public /webiste`
- This will:
	- Wait to connect to a peer for your drive
	- Make sure the metadata has been synced with a peer
	- Sync data from the `./public` folder on your filesystem to the `/website` folder in the hyperdrive	
	- Wait for 5 seconds to sync with the peer (configurable with `--sync-time`)
	- Exit 

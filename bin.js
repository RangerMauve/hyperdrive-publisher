#!/usr/bin/env node

const { sync, create } = require('./')

require('yargs')
  .scriptName('hyperdrive-publisher')
  .command(
    'create [seed]',
    'Create a new seed and url for a hyperdrive',
    {
    },
    create
  )
  .command(
    'sync <seed> [fsPath] [drivePath]',
    'sync a folder to your hyperdrive',
    {
      syncTime: {
        default: 5000,
        describe: 'How long to wait to sync with remote peers'
      }
    },
    sync
  )
  .parse()

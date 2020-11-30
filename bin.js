#!/usr/bin/env node

const { sync, create, getURL } = require('./')

require('yargs')
  .scriptName('hyperdrive-publisher')
  .command(
    'create [seed]',
    'Create a new seed and url for a hyperdrive',
    {
      verbose: {
        alias: 'v',
        default: true,
        describe: 'Toggles console output'
      }
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
      },
      verbose: {
        alias: 'v',
        default: true,
        describe: 'Toggles console output'
      }
    },
    sync
  )
  .command(
    'getURL <seed>',
    'get the hyper:// URL for a seed',
    {
      verbose: {
        alias: 'v',
        default: true,
        describe: 'Toggles console output'
      }
    },
    getURL)
  .parse()

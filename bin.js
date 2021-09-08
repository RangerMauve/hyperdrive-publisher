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
      },
      title: {
        alias: 't',
        describe: 'Title for your hyperdrive',
        type: 'string'
      }
    },
    create
  )
  .command(
    'sync <seed> [fsPath] [drivePath]',
    'sync a folder to your hyperdrive',
    {
      verbose: {
        alias: 'v',
        default: true,
        describe: 'Toggles console output'
      },
      tag: {
        alias: 't',
        describe: 'Tags the updated version of the hyperdrive',
        type: 'string'
      },
      ignore: {
        alias: 'i',
        describe: 'glob patterns to ignore',
        default: ['.git/**'],
        type: 'array'
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

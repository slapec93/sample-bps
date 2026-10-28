#!/usr/bin/env node
import { Bee, BpsPosition, PrivateKey, Topic } from '@ethersphere/bee-js'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const STATE_FILE = new URL('.bps-state.json', import.meta.url)
const RECONNECT_DELAY = 3000
const HEARTBEAT = 60_000

const { BEE_URL = 'http://localhost:1633', BROKER, PRIVATE_KEY, TOPIC = 'sample-bps' } = process.env
const [command, ownerArg] = process.argv.slice(2)
const topic = Topic.fromString(TOPIC)

function fail(message) {
  console.error(message)
  process.exit(1)
}

function requireEnv(name, value) {
  if (!value) {
    fail(`${name} is not set, see README.md`)
  }

  return value
}

function short(address) {
  return address.toHex().slice(0, 8)
}

function loadState(key) {
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
  const entry = state[key] ?? {}

  return { index: BigInt(entry.index ?? 0), rosterIndex: BigInt(entry.rosterIndex ?? 0) }
}

function saveState(key, publisher) {
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
  state[key] = { index: publisher.nextIndex.toString(), rosterIndex: publisher.nextRosterIndex.toString() }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function printMessage({ publisher, index, payload }) {
  console.log(`[${short(publisher)} #${index}] ${payload.toUtf8()}`)
}

function printRoster(roster) {
  console.log(`* roster: ${roster.length ? roster.map(address => address.toHex()).join(', ') : '(empty)'}`)
}

function generateKey() {
  const key = new PrivateKey(globalThis.crypto.getRandomValues(new Uint8Array(32)))
  console.log(`PRIVATE_KEY=${key.toHex()}`)
  console.log(`address:    ${key.publicKey().address().toHex()}`)
}

function subscribe(owner) {
  const bee = new Bee(BEE_URL)
  const broker = requireEnv('BROKER', BROKER)
  let position = new BpsPosition(owner)

  function connect() {
    bee.messaging.bpsSubscribe(
      owner,
      topic,
      {
        onMessage: printMessage,
        onRoster: printRoster,
        onError: error => console.error(`! ${error.message}`),
        onClose: (subscription, event) => {
          position = subscription.position

          if (event.ended) {
            console.log('* channel ended by the owner')
            process.exit(0)
          }
          console.log(`* disconnected (${event.code} ${event.reason}), reconnecting...`)
          setTimeout(connect, RECONNECT_DELAY)
        },
      },
      { broker, position },
    )
  }

  console.log(`* subscribing to ${owner} / "${TOPIC}"`)
  connect()
}

async function publish(ownerHex) {
  const signer = new PrivateKey(requireEnv('PRIVATE_KEY', PRIVATE_KEY))
  const identity = signer.publicKey().address()
  const owner = ownerHex ?? identity.toHex()
  const isOwner = owner.toLowerCase().replace(/^0x/, '') === identity.toHex()
  const stateKey = `${owner}/${TOPIC}/${identity.toHex()}`
  const bee = new Bee(BEE_URL, { signer })

  console.log(`* publishing to ${owner} / "${TOPIC}" as ${identity.toHex()} (${isOwner ? 'owner' : 'seat'})`)

  if (!isOwner) {
    console.log('* waiting for the owner to grant a seat...')
  }

  const publisher = await bee.messaging.bpsPublish(
    owner,
    topic,
    { broker: requireEnv('BROKER', BROKER), heartbeat: HEARTBEAT, ...loadState(stateKey) },
    {
      onMessage: message => {
        if (!message.publisher.equals(identity)) {
          printMessage(message)
        }
      },
      onRoster: printRoster,
      onError: error => console.error(`! ${error.message}`),
      onClose: (_, event) => {
        console.log(`* closed (${event.code} ${event.reason})`)
        process.exit(event.ended ? 0 : 1)
      },
    },
  )

  console.log(`* ready. Type a message${isOwner ? ', /roster <address> ..., /end' : ''} or /quit`)

  const input = createInterface({ input: process.stdin })

  for await (const line of input) {
    const [cmd, ...rest] = line.trim().split(/\s+/)

    try {
      if (cmd === '/quit') {
        break
      } else if (cmd === '/roster') {
        publisher.setRoster(rest)
        console.log(`* roster sent (${rest.length} seats)`)
      } else if (cmd === '/end') {
        publisher.end()
      } else if (line.trim()) {
        publisher.send(line)
      }
    } catch (error) {
      console.error(`! ${error.message}`)
    }
    saveState(stateKey, publisher)
  }

  saveState(stateKey, publisher)
  publisher.cancel()
  process.exit(0)
}

switch (command) {
  case 'key':
    generateKey()
    break
  case 'subscribe':
    subscribe(ownerArg ?? fail('usage: node bps.js subscribe <owner-address>'))
    break
  case 'publish':
    await publish(ownerArg)
    break
  default:
    fail('usage: node bps.js key | publish [owner-address] | subscribe <owner-address>')
}

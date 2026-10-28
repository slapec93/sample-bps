# sample-bps

A minimal terminal chat built on **BPS-lite** (Bee pubsub, [bee#5626](https://github.com/ethersphere/bee/pull/5626)) using bee-js.

- The **owner** of a channel publishes messages and decides who else may write (the **roster**).
- **Seats** (rostered addresses) can publish too.
- **Subscribers** only listen. They need no key and no postage stamp.

Messages are relayed live through a **broker** node. Nothing is stored, so a new subscriber only sees messages sent after it joined.

## Requirements

- Node.js 20+
- `@ethersphere/bee-js@13.3.0-upcoming.g4568f7a`, a pre-release build with BPS support. It's pinned in `package.json` and installed by `npm install`.
- A Bee node built from [bee#5626](https://github.com/ethersphere/bee/pull/5626), reachable at `BEE_URL`.
- A broker: a full node from the same build, started with `--bps-broker`. It can be your own node. You need its overlay address:

  ```sh
  curl -s http://localhost:1633/addresses | jq -r .overlay
  ```

## Install

```sh
npm install
```

## Configuration

Set these as environment variables:

| Variable      | Required        | Default                 | Meaning                                         |
| ------------- | --------------- | ----------------------- | ----------------------------------------------- |
| `BROKER`      | yes             |                         | Overlay address of the broker node              |
| `PRIVATE_KEY` | for `publish`   |                         | Your signing key. Its address is your identity  |
| `BEE_URL`     | no              | `http://localhost:1633` | Your Bee API                                    |
| `TOPIC`       | no              | `sample-bps`            | Channel name. Owner and topic define a channel  |

## Usage

### 1. Create keys

```sh
node bps.js key
# PRIVATE_KEY=3f1c...
# address:    9a2b...
```

Run this once for the owner, and once for each person who should get a seat.

### 2. Owner: open the channel

```sh
export BROKER=<broker overlay>
PRIVATE_KEY=<owner key> node bps.js publish
```

Type a line and press Enter to send it. The owner also has these commands:

- `/roster <address> <address> ...` grants seats to these addresses. Each call replaces the whole roster, so `/roster` with no addresses revokes all seats.
- `/end` closes the channel for everyone.
- `/quit` disconnects but leaves the channel open.

### 3. Anyone: listen

```sh
BROKER=<broker overlay> node bps.js subscribe <owner address>
```

This prints messages from the owner and from seats, plus roster changes. If the connection drops, it reconnects and continues from where it stopped, without duplicates. It exits when the owner sends `/end`.

### 4. Seat: publish as a rostered address

```sh
PRIVATE_KEY=<seat key> BROKER=<broker overlay> node bps.js publish <owner address>
```

The seat waits until the owner has added its address with `/roster`, then works like the owner's prompt, without `/roster` and `/end`.

## Example session

```text
# terminal 1, the owner
$ PRIVATE_KEY=$OWNER_KEY node bps.js publish
* publishing to 32350b3d... / "sample-bps" as 32350b3d... (owner)
* ready. Type a message, /roster <address> ..., /end or /quit
hello swarm
/roster c0eed5ae901acdf22eb5c3c54a5ede1b86f80a16

# terminal 2, a subscriber
$ node bps.js subscribe 32350b3d12c0c8bebd20c600daff7ede370a0c01
* subscribing to 32350b3d... / "sample-bps"
[32350b3d #0] hello swarm
* roster: c0eed5ae901acdf22eb5c3c54a5ede1b86f80a16
[c0eed5ae #0] hi from a seat
```

## How it maps to bee-js

```js
import { Bee, Topic } from '@ethersphere/bee-js'

const topic = Topic.fromString('sample-bps')

const bee = new Bee('http://localhost:1633', { signer: privateKey })
const publisher = await bee.messaging.bpsPublish(owner, topic, { broker })
publisher.send('hello')
publisher.setRoster([seatAddress])
publisher.end()

const reader = new Bee('http://localhost:1633')
const subscription = reader.messaging.bpsSubscribe(owner, topic, {
  onMessage: ({ publisher, index, payload }) => console.log(payload.toUtf8()),
  onError: console.error,
  onClose: (subscription, event) => {
    // to resume after a drop, pass { position: subscription.position } to bpsSubscribe
  },
}, { broker })
```

## Good to know

- **Message indexes must never be reused.** A publisher's indexes start at 0 and only go up, and the broker drops anything older than what it has already seen. This app saves the next index for each owner, topic and identity in `.bps-state.json`. Don't delete that file while a channel is in use.
- **Nothing is persisted.** BPS is for live messages only. Store anything that must outlive the session somewhere else, such as a Swarm feed.
- **Two streams per node and channel.** The broker allows at most two connections to one channel through the same Bee node. A third, such as a subscriber, an owner and a seat on one node, is refused with `join FULL`. Run the roles on different Bee nodes.
- **Ordering** is guaranteed only within one publisher's messages, not across publishers.
- **Keepalive.** The broker drops a channel after 10 minutes of inactivity. The publisher sends a heartbeat every 60 seconds to keep it open.

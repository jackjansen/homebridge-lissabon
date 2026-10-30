# homebridge-lissabon

A [Homebridge](https://homebridge.io) plugin that makes [Lissabon](https://github.com/cwi-dis/lissabon) lamps available in Apple HomeKit. Lissabon is a family of low-power lighting devices (dimmers and LED strips) built on the [iotsa](https://github.com/cwi-dis/iotsa) framework.

The plugin finds lamps by itself, over WiFi and over Bluetooth LE, and exposes each one as a HomeKit Lightbulb with on/off and, if the lamp has them, brightness and color temperature.

## How it behaves

- **Discovery only.** Lamps are found through mDNS (`_iotsa._tcp`, for WiFi) and BLE scanning (the Lissabon GATT service). There is no list of lamps to configure.
- **One accessory per lamp,** identified by the lamp's hostname, whichever way it is reached. A lamp seen over both WiFi and BLE is still one accessory.
- **A lamp sticks to the transport it is using.** It uses the transport that found it first, and switches to the other one, if known, after two consecutive failures. A lamp that fails on all its transports shows as "No Response", and keeps being tried.
- **HomeKit is answered from a cache.** Reads return at once and writes are queued, so a sleeping BLE lamp doesn't make HomeKit wait. The lamp is polled in the background and read back shortly after every write, so changes made elsewhere (a button, a remote) show up in HomeKit within one poll interval.
- **Unreachable lamps show as "No Response"** in the Home app; the log says so too. The Homebridge web UI has no way of showing this.
- **Lamps are never removed automatically,** because removing an accessory also removes it from its room, scenes and automations in Home, and a lamp may just be unplugged or in storage. Remove a lamp by hand when it is really gone: in the Home app, or with "Remove Single Cached Accessory" in the Homebridge UI.
- **Two-channel lamps** expose only their main dimmer. Over BLE, switching such a lamp off also switches off the second channel, and it reads as on if either channel is on.

## Requirements

- Homebridge 1.8 or later, or 2.x
- Node.js 22 or 24

## Installation

The plugin is not published on npm, so it is built from a checkout. These instructions are for a Homebridge installed from the [Homebridge apt repository](https://github.com/homebridge/homebridge/wiki/Install-Homebridge-on-Debian-or-Ubuntu-Linux), which has its own Node.js in `/opt/homebridge/bin` and keeps its data in `/var/lib/homebridge`. Build with the Node.js that runs Homebridge, so that one has to come first in the path.

```
export PATH=/opt/homebridge/bin:$PATH
git clone https://github.com/jackjansen/homebridge-lissabon.git
cd homebridge-lissabon
npm install && npm run build && npm pack
```

Then install the resulting package into Homebridge, as the `homebridge` user. The package is copied into Homebridge's own directory because npm records its path, and because the `homebridge` user usually can't read your home directory.

```
sudo install -o homebridge -g homebridge jackjansen-homebridge-lissabon-*.tgz /var/lib/homebridge/homebridge-lissabon.tgz
cd /var/lib/homebridge
sudo -u homebridge -H env PATH=$PATH npm install ./homebridge-lissabon.tgz
```

### Bluetooth LE on Linux

On Linux, the BLE library talks to the Bluetooth hardware directly, which needs extra rights for the Node.js binary:

```
sudo setcap cap_net_raw,cap_net_admin+eip /opt/homebridge/bin/node
```

A Homebridge update that replaces Node.js removes these rights again, so this may need repeating. On macOS, the system asks for Bluetooth permission the first time instead.

## Configuration

Add the platform to Homebridge's `config.json`, or use the settings form in the Homebridge UI:

```json
{
    "platform": "LissabonLighting",
    "name": "LissabonLighting",
    "options": {
        "discoverWifi": true,
        "discoverBle": true
    }
}
```

| Option | Default | Meaning |
|---|---|---|
| `discoverWifi` | off | Find lamps over WiFi, using mDNS |
| `discoverBle` | off | Find lamps over Bluetooth LE |
| `wifiPollInterval` | 30 | Seconds between background reads of a lamp over WiFi |
| `blePollInterval` | 300 | Seconds between background reads of a lamp over BLE |

Every BLE read wakes the lamp and keeps it awake for its `activityExtraWakeDuration`, so short BLE poll intervals cost battery on battery-powered lamps.

Log lines have the form `[lamp] transport message (duration)`. Sets, discoveries and failures are logged normally; reads and connection steps only in Homebridge's debug mode.

## Development

```
npm install
npm run build
npm link        # makes the checkout available to a globally installed Homebridge
npm run lint
```

### Running a test server

To avoid disturbing a production bridge, test with a separate Homebridge instance that has its own bridge `username` and `port`. Don't run it next to a production instance that uses the same lamps over BLE: both would keep connecting to them.

On a development machine, install Homebridge and its web UI globally, once, and link the plugin as above:

```
npm install -g homebridge homebridge-config-ui-x
```

Start the server in a separate terminal. It stays in the foreground, and Ctrl-C stops it:

```
hb-service run
```

The web UI is at <http://localhost:8581>, and the configuration and accessory cache are in `~/.homebridge`. Add the platform in the UI as described under [Configuration](#configuration).

After a code change, `npm run build` and a restart from the UI are enough. Debug log lines need Homebridge's debug mode (in the UI's Homebridge settings, or `-D`). The UI's Accessories page can show stale tiles after accessories change: reload the page.

### Source layout

Everything is in `src/`:

| File | What |
|---|---|
| `platform.ts` | Discovery, and the bookkeeping of accessories |
| `lampAccessory.ts` | One lamp as a HomeKit Lightbulb: cache, write queue, polling, choice of transport. Its class comment describes the control flow |
| `transport.ts` | The interface of a transport, in device units, without HomeKit knowledge |
| `iotsaRestTransport.ts` | The iotsa REST API, over WiFi |
| `lissabonBleTransport.ts` | The Lissabon GATT service, over BLE, with timeouts |
| `bleQueue.ts` | One BLE operation at a time, plugin-wide |
| `deviceModel.ts` | Which iotsa modules are exposed to HomeKit |
| `lampLog.ts` | The uniform log lines |

The design decisions and their reasons are in [issue #1](https://github.com/jackjansen/homebridge-lissabon/issues/1).

## License

Apache-2.0, see [LICENSE](LICENSE).

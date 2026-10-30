import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { LissabonConfig, LissabonOptions, LampContext } from './config';
import { LampLog, reasonText } from './lampLog';
import { LissabonLampAccessory } from './lampAccessory';
import { lampModuleFor } from './deviceModel';
import { LampTransport, TransportKind, describeCapabilities } from './transport';
import { IotsaRestTransport } from './iotsaRestTransport';
import { LissabonBleTransport, bleLissabonService } from './lissabonBleTransport';
import noble, { Peripheral } from '@stoprocent/noble';
import { Bonjour, Service as MdnsService } from 'bonjour-service';
import { isIPv4 } from 'net';

// Default poll intervals, seconds (Decided 9 in #1)
const defaultWifiPollInterval = 30;
const defaultBlePollInterval = 300;

// How long to wait before probing a lamp again after a failed BLE probe, seconds
const bleProbeRetryInterval = 60;

/**
 * The plugin: discovers lamps (mDNS for WiFi, scanning for BLE) and keeps one accessory per lamp,
 * identified by its hostname (Decided 1 in #1), whichever transports find it.
 */
export class LissabonHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // Accessories restored from the cache or created in this run
  public readonly accessories: PlatformAccessory[] = [];

  // One lamp accessory per accessory, by accessory UUID
  private readonly lamps = new Map<string, LissabonLampAccessory>();

  // Peripherals whose BLE probe failed before, by id: only the first failure is logged as a warning
  private readonly bleProbeFailed = new Set<string>();

  private options! : LissabonOptions;

  constructor(
    public readonly log: Logger,
    public readonly config: LissabonConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.log.debug('Finished initializing platform:', this.config.name);
    if (!config || !config.options) {
      this.log.error('No configuration options found');
      return;
    }
    this.options = config.options;

    // Homebridge has restored all cached accessories when this fires; only then may new ones be registered
    this.api.on('didFinishLaunching', () => {
      this.handleCachedAccessories();
      if (this.options.discoverWifi) {
        this.discoverWifiDevices();
      }
      if (this.options.discoverBle) {
        this.discoverBleDevices();
      }
    });
  }

  /**
   * Invoked by Homebridge for every accessory restored from the cache, before didFinishLaunching.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private pollIntervals() : Record<TransportKind, number> {
    return {
      wifi: this.options.wifiPollInterval || defaultWifiPollInterval,
      ble: this.options.blePollInterval || defaultBlePollInterval,
    };
  }

  /**
   * Remove cached accessories from older plugin versions (not identified by hostname). The others get a
   * lamp accessory without transports, which HomeKit shows as "No Response" until a transport finds the lamp.
   * Lamps are never removed automatically: removal also removes them from Home, with their room, scenes and
   * automations, and a lamp may just be unplugged or in storage. Remove them by hand (Home app, or the
   * Homebridge UI's "Remove Single Cached Accessory").
   */
  private handleCachedAccessories() {
    const remove : PlatformAccessory[] = [];
    for (const accessory of this.accessories) {
      const context : LampContext | undefined = accessory.context.device;
      if (context === undefined || context.hostname === undefined) {
        this.log.info('Removing cached accessory from an older plugin version:', accessory.displayName);
        remove.push(accessory);
      } else {
        const lamp = new LissabonLampAccessory(this, accessory, this.pollIntervals());
        lamp.showNotFoundYet();
        this.lamps.set(accessory.UUID, lamp);
      }
    }
    this.removeAccessories(remove);
  }

  private removeAccessories(remove : PlatformAccessory[]) {
    if (remove.length === 0) {
      return;
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, remove);
    for (const accessory of remove) {
      this.lamps.get(accessory.UUID)?.stop();
      this.lamps.delete(accessory.UUID);
      this.accessories.splice(this.accessories.indexOf(accessory), 1);
    }
  }

  /**
   * A transport found a lamp: find or create its accessory and hand it the transport.
   */
  private lampFound(name : string, type : string, transport : LampTransport) {
    const hostname = name.toLowerCase();
    const uuid = this.api.hap.uuid.generate(hostname);
    let lamp = this.lamps.get(uuid);
    if (lamp === undefined) {
      this.log.info('Adding new accessory:', name, '(' + transport.kind + ')');
      const accessory = new this.api.platformAccessory(name, uuid);
      const context : LampContext = {
        hostname: hostname,
        name: name,
        type: type,
        hasBrightness: transport.capabilities.hasLevel,
        hasTemperature: transport.capabilities.hasTemperature,
      };
      accessory.context.device = context;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
      lamp = new LissabonLampAccessory(this, accessory, this.pollIntervals());
      this.lamps.set(uuid, lamp);
    }
    lamp.addTransport(transport);
  }

  private discoverWifiDevices() {
    // find() starts browsing, and keeps listening for lamps that appear later
    const browser = new Bonjour().find({ type: 'iotsa' });
    browser.on('up', (service : MdnsService) => {
      void this.mdnsServiceUp(service);
    });
    browser.on('down', (service : MdnsService) => {
      new LampLog(this.log, service.name, 'mdns').debug('service down');
    });
    this.log.info('mDNS: Started browsing for services.');
  }

  private async mdnsServiceUp(service : MdnsService) {
    const name = service.name;
    const module = lampModuleFor(Object.keys(service.txt ?? {}));
    const addresses = service.addresses ?? [];
    if (name === undefined || name === '') {
      // Without a name there is no hostname, and so no identity
      this.log.debug('mDNS: service without name, ignoring:', addresses);
      return;
    }
    if (module === undefined) {
      this.log.debug('mDNS: service ' + name + ' is not a lamp, ignoring');
      return;
    }
    const lampLog = new LampLog(this.log, name, 'mdns');
    lampLog.debug('service up, addresses ' + addresses.join(' '));
    // The IPv4 address avoids a slow .local lookup on macOS (Decided 5 in #1)
    const address = addresses.find(a => isIPv4(a)) ?? name + '.local.';
    let capabilities;
    try {
      capabilities = await IotsaRestTransport.probe(address, module);
    } catch(error) {
      lampLog.warn('cannot get capabilities, ignored for now: ' + reasonText(error));
      return;
    }
    lampLog.info('found ' + address + ', ' + module + ', ' + describeCapabilities(capabilities));
    this.lampFound(name, module, new IotsaRestTransport(address, module, capabilities));
  }

  private discoverBleDevices() {
    this.log.info('BLE: Waiting for poweron...');
    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn') {
        this.log.info('BLE: Starting BLE scan for Lissabon devices...');
        noble.startScanning([bleLissabonService], false);
      } else {
        // E.g. poweredOff: on Linux, check hciconfig and rfkill
        this.log.warn('BLE: adapter state is ' + state + ', not scanning');
        await noble.stopScanningAsync();
      }
    });
    noble.on('discover', (peripheral : Peripheral) => {
      void this.blePeripheralDiscovered(peripheral);
    });
  }

  private async blePeripheralDiscovered(peripheral : Peripheral) {
    if (!peripheral?.advertisement?.serviceUuids?.includes(bleLissabonService)) {
      return;
    }
    // iotsa advertises the hostname as the BLE name
    const name = peripheral.advertisement.localName || peripheral.address || peripheral.id;
    const lampLog = new LampLog(this.log, name, 'ble');
    lampLog.debug('advertisement seen, id ' + peripheral.id + ', address "' + peripheral.address + '", rssi ' + peripheral.rssi);
    const t0 = Date.now();
    let capabilities;
    try {
      capabilities = await LissabonBleTransport.probe(peripheral, lampLog);
    } catch(error) {
      // The scan reports a peripheral only once, so without a retry the lamp would stay away until a restart
      const message = `discovery failed: ${reasonText(error)}, retrying every ${bleProbeRetryInterval} s`;
      if (this.bleProbeFailed.has(peripheral.id)) {
        lampLog.debug(message, t0);
      } else {
        lampLog.warn(message, t0);
        this.bleProbeFailed.add(peripheral.id);
      }
      setTimeout(() => void this.blePeripheralDiscovered(peripheral), bleProbeRetryInterval * 1000);
      return;
    }
    if (capabilities === undefined) {
      lampLog.warn('ignored: no isOn characteristic');
      return;
    }
    // A lamp with temperature is a ledstrip; it doesn't matter over BLE, but it is the accessory's model
    const type = capabilities.hasTemperature ? 'ledstrip' : 'dimmer';
    const transport = new LissabonBleTransport(peripheral, capabilities, lampLog);
    lampLog.info('found ' + transport.describe() + ', ' + describeCapabilities(capabilities), t0);
    this.lampFound(name, type, transport);
  }
}

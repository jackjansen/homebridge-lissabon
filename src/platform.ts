import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import {
  LissabonBlePlatformAccessory,
  bleLissabonService,
  bleLissabonCharacteristic_isOn,
  bleLissabonCharacteristic_brightness,
  bleLissabonCharacteristic_temperature,
} from './platformBleAccessory';
import { LissabonWiFiPlatformAccessory } from './platformWiFiAccessory';
import { LissabonUnreachableAccessory } from './platformUnreachableAccessory';
import { LissabonConfig, LissabonDevice, LissabonOptions } from './config';
import { LampLog, reasonText } from './lampLog';
import noble, { Peripheral } from '@stoprocent/noble';
import mdns from 'mdns';
import axios from 'axios';
import { isIPv4 } from 'net';

type LissabonAccessoryHandler = LissabonBlePlatformAccessory | LissabonWiFiPlatformAccessory | LissabonUnreachableAccessory;

// Which handler an accessory has; a higher rank replaces a lower one (WiFi is preferred over BLE)
type HandlerKind = 'unreachable' | 'ble' | 'wifi';
const handlerRank : Record<HandlerKind, number> = { unreachable: 0, ble: 1, wifi: 2 };

// A cached lamp that no transport has found for this long is removed (which also removes it from Home)
const removeAfterMs = 30 * 24 * 3600 * 1000;

function capabilities(device : LissabonDevice) : string {
  let rv = device.type + ', on/off';
  if (device.hasBrightness) {
    rv += ', brightness';
  }
  if (device.hasTemperature) {
    rv += ', temperature';
  }
  return rv;
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class LissabonHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  // accessory handlers created in this run, by accessory UUID, so discovery seeing a device again doesn't create a second one
  private readonly handlers = new Map<string, { kind : HandlerKind; handler : LissabonAccessoryHandler }>();

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
    
    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.handleCachedAccessories();
      this.registerDevices();
      if (this.options.discoverWifi) {
        this.discoverWifiDevices();
      }
      if (this.options.discoverBle) {
        this.discoverBleDevices();
      }
    });

  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Remove cached accessories from older plugin versions (not identified by hostname) and lamps not found
   * for a long time. The others get a handler that reports "No Response" until a transport finds them.
   */
  handleCachedAccessories() {
    const now = Date.now();
    const remove : PlatformAccessory[] = [];
    for (const accessory of this.accessories) {
      const device : LissabonDevice | undefined = accessory.context.device;
      if (device === undefined || device.hostname === undefined) {
        this.log.info('Removing cached accessory from an older plugin version:', accessory.displayName);
        remove.push(accessory);
      } else if (device.lastSeen !== undefined && now - device.lastSeen > removeAfterMs) {
        this.log.info('Removing cached accessory not seen since', new Date(device.lastSeen).toISOString() + ':', accessory.displayName);
        remove.push(accessory);
      } else if (!this.handlers.has(accessory.UUID)) {
        this.handlers.set(accessory.UUID, { kind: 'unreachable', handler: new LissabonUnreachableAccessory(this, accessory) });
      }
    }
    if (remove.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, remove);
      for (const accessory of remove) {
        this.accessories.splice(this.accessories.indexOf(accessory), 1);
      }
    }
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  discoverWifiDevices() {
    const browser = mdns.createBrowser(mdns.tcp('_iotsa'));
    browser.on('serviceUp', (service: mdns.Service) => {
      this.mdnsServiceUp(service);
    });
    browser.on('serviceDown', (service: mdns.Service) => {
      this.mdnsServiceDown(service);
    });
    browser.start();
    this.log.info('mDNS: Started browsing for services.');
  }

  async mdnsServiceUp(service : mdns.Service) {
    if (service.txtRecord === undefined) {
      this.log.debug('mDNS: service ' + service.name + ' has no txtRecord, ignoring');
      return;
    }
    let type : string;
    if (service.txtRecord.dimmer !== undefined) {
      type = 'dimmer';
    } else if (service.txtRecord.ledstrip !== undefined) {
      type = 'ledstrip';
    } else {
      this.log.debug('mDNS: service ' + service.name + ' has no dimmer or ledstrip service, ignoring');
      return;
    }
    const ipAddress = service.addresses.find(a => isIPv4(a));
    let address = ipAddress ?? service.addresses[0];
    let name = service.name;
    if (name === '' || name === undefined ) {
      name = address;
    } else {
      address = name + '.local.';
    }
    const lampLog = new LampLog(this.log, name, 'mdns');
    lampLog.debug('service up, addresses ' + service.addresses.join(' '));
    const device : LissabonDevice = {
      hostname : name.toLowerCase(),
      address : address,
      name : name,
      type : type,
      hasBrightness : false,
      hasTemperature : false,
      isBluetooth : false,
      ipAddress : ipAddress,
    };
    // Ask the device which values it has
    try {
      const { data } = await axios.get(`http://${ipAddress ?? address}/api/${type}`, { timeout: 5000 });
      device.hasBrightness = data.level !== undefined;
      device.hasTemperature = data.temperature !== undefined;
    } catch(error) {
      lampLog.warn('cannot get capabilities, assuming on/off only: ' + reasonText(error));
    }
    lampLog.info('found ' + (ipAddress ?? address) + ', ' + capabilities(device));
    this.registerDevice(device, undefined);
  }

  mdnsServiceDown(service : mdns.Service) {
    new LampLog(this.log, service.name ?? '?', 'mdns').debug('service down');
  }

  discoverBleDevices() {
    const wantedServiceUuids = [bleLissabonService];
    this.log.info('BLE: Waiting for poweron...');
    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn') {
        this.log.info('BLE: Starting BLE scan for Lissabon devices...');
        noble.startScanning(wantedServiceUuids, false);
      } else {
        this.log.info('BLE: Stopping BLE scan...');
        await noble.stopScanningAsync(); 
      }        
    });
    noble.on('discover', this.blePeripheralDiscovered.bind(this));
  }

  async blePeripheralDiscovered(peripheral : Peripheral) {
    if (!peripheral || !peripheral.advertisement) {
      return;
    }
    if (!peripheral.advertisement.serviceUuids) {
      return;
    }
    if (peripheral.advertisement.serviceUuids.indexOf(bleLissabonService) < 0) {
      return;
    }
    const lampLog = new LampLog(this.log, peripheral.advertisement.localName || peripheral.id, 'ble');
    lampLog.debug('advertisement seen, id ' + peripheral.id + ', address "' + peripheral.address + '", rssi ' + peripheral.rssi);
    const t0 = Date.now();
    try {
      //await noble.stopScanningAsync();
      //this.log.info('xxxjack stopScanning done');
      await peripheral.connectAsync();
      lampLog.debug('connected', t0);
      //this.log.info('xxx now peripheral: ', peripheral);
      const wtdServices = [bleLissabonService];
      const wtdCharacteristics = [
        bleLissabonCharacteristic_isOn,
        bleLissabonCharacteristic_brightness,
        bleLissabonCharacteristic_temperature,
      ];
      const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(wtdServices, wtdCharacteristics);
      //this.log.info('xxxjack services: ', services);
      //this.log.info('xxxjack characteristics: ', characteristics);
      let has_isOn = false;
      let has_brightness = false;
      let has_temperature = false;
      for (const ch of characteristics) {
        lampLog.debug('characteristic ' + ch.uuid);
        if (ch.uuid === bleLissabonCharacteristic_isOn) {
          has_isOn = true;
        }
        if (ch.uuid === bleLissabonCharacteristic_brightness) {
          has_brightness = true;
        }
        if (ch.uuid === bleLissabonCharacteristic_temperature) {
          has_temperature = true;
        }
      }
      if (!has_isOn) {
        lampLog.warn('ignored: no isOn characteristic');
      } else {
        // We need to provide different addresses depending on whether it's Linux or MacOS.
        // And we need to provide a default for the name.
        let address = peripheral.address;
        if (address === '') {
          address = peripheral.uuid;
        }
        let name = peripheral.advertisement.localName;
        if (name === '') {
          name = address;
        }
        const type = has_temperature ? 'ledstrip' : 'dimmer';
        const device : LissabonDevice = {
          hostname : name.toLowerCase(),
          address : address,
          name : name,
          type : type,
          hasBrightness : has_brightness,
          hasTemperature : has_temperature,
          isBluetooth : true,
        };
        lampLog.info('found id ' + address + ', ' + capabilities(device), t0);
        this.registerDevice(device, peripheral);
      }
      await peripheral.disconnectAsync();
      lampLog.debug('disconnected');
    } catch(error) {
      lampLog.warn('discovery failed: ' + reasonText(error), t0);
    }
  }

  registerDevices() {
    // loop over the discovered devices and register each one if it has not already been registered
    if (!this.options || !this.options.devices) {
      this.log.warn('No devices configured');
      return;
    }
    for (const device of this.options.devices) {
      // The settings UI can save an empty entry; skipping it keeps discovery (started after this) working
      if (!device.address) {
        this.log.warn('Ignoring configured device without address:', device);
        continue;
      }
      if (!device.name) {
        device.name = device.address;
      }
      device.hostname = device.name.toLowerCase();
      this.registerDevice(device, undefined);
    }
  }

  registerDevice(device : LissabonDevice, noblePeripheral? : Peripheral) {
    // One accessory per lamp, whichever transport finds it: the hostname is the identity (Decided 1 in #1)
    const uuid = this.api.hap.uuid.generate(device.hostname);
    const kind : HandlerKind = device.isBluetooth ? 'ble' : 'wifi';
    device.lastSeen = Date.now();

    const existingHandler = this.handlers.get(uuid);
    let accessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (existingHandler !== undefined && accessory !== undefined) {
      if (existingHandler.kind === kind) {
        // Seen again over the same transport (mDNS reports a service once per network interface). Refresh what
        // discovery learned, such as the IP address; the handler shares the context.device object.
        Object.assign(accessory.context.device, device);
        this.api.updatePlatformAccessories([accessory]);
        this.log.debug('Already handling accessory:', accessory.displayName);
        return;
      }
      if (handlerRank[existingHandler.kind] > handlerRank[kind]) {
        this.log.debug('Accessory', accessory.displayName, 'also reachable over', kind + ', keeping', existingHandler.kind);
        return;
      }
      this.log.info('Accessory', accessory.displayName, 'now reachable over', kind + ', was', existingHandler.kind);
    }

    if (accessory === undefined) {
      this.log.info('Adding new accessory:', device.name, '(' + kind + ')');
      accessory = new this.api.platformAccessory(device.name, uuid);
      accessory.context.device = device;
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      // remember it, so a second discovery doesn't register it again
      this.accessories.push(accessory);
    } else {
      // the cached context may be stale (older plugin version, changed capabilities), use what discovery found
      accessory.context.device = device;
      this.api.updatePlatformAccessories([accessory]);
    }

    // A new handler replaces the previous one's characteristic handlers
    this.handlers.set(uuid, { kind: kind, handler: this.createHandler(accessory, device, noblePeripheral) });
  }

  createHandler(accessory : PlatformAccessory, device : LissabonDevice, noblePeripheral? : Peripheral) : LissabonAccessoryHandler {
    if (device.isBluetooth) {
      return new LissabonBlePlatformAccessory(this, accessory, noblePeripheral as Peripheral);
    }
    return new LissabonWiFiPlatformAccessory(this, accessory);
  }
}

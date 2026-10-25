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
import { LissabonConfig, LissabonDevice, LissabonOptions } from './config';
import noble, { Peripheral } from '@stoprocent/noble';
import mdns from 'mdns';
import axios from 'axios';
import { isIPv4 } from 'net';

type LissabonAccessoryHandler = LissabonBlePlatformAccessory | LissabonWiFiPlatformAccessory;

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
  private readonly handlers = new Map<string, LissabonAccessoryHandler>();

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
    this.log.debug('mDNS: service ' + service.name + ' should be a Lissabon device: ', service);
    const ipAddress = service.addresses.find(a => isIPv4(a));
    let address = ipAddress ?? service.addresses[0];
    let name = service.name;
    if (name === '' || name === undefined ) {
      name = address;
    } else {
      address = name + '.local.';
    }
    const device : LissabonDevice = {
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
      this.log.warn('mDNS: cannot get capabilities of ' + name + ', assuming on/off only: ', error);
    }
    this.registerDevice(device, undefined);
  }

  mdnsServiceDown(service : mdns.Service) {
    this.log.debug('mDNS: service down: ', service);
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
    this.log.debug('BLE: peripheral discovered: ', peripheral);
    if (!peripheral || !peripheral.advertisement) {
      return;
    }
    if (!peripheral.advertisement.serviceUuids) {
      return;
    }
    if (peripheral.advertisement.serviceUuids.indexOf(bleLissabonService) < 0) {
      return;
    }
    this.log.debug('BLE: peripheralDiscovered addr=', peripheral.address, ', name =', peripheral.advertisement.localName);
    this.log.debug('BLE: advertisement: ', peripheral.advertisement);
    try {
      //await noble.stopScanningAsync();
      //this.log.info('xxxjack stopScanning done');
      await peripheral.connectAsync();
      this.log.debug('BLE: connectAsync done');
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
        this.log.debug('BLE: characteristic: ', ch.uuid);
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
        this.log.warn('BLE: BLE device without isOn characteristic ignored');
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
          address : address,
          name : name,
          type : type,
          hasBrightness : has_brightness,
          hasTemperature : has_temperature,
          isBluetooth : true,
        };
        this.registerDevice(device, peripheral);
      }
      await peripheral.disconnectAsync();
      this.log.debug('BLE: disconnectAsync done');
    } catch(error) {
      this.log.error('BLE: discoverServices error: ', error);
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
      this.registerDevice(device, undefined);
    }
  }

  registerDevice(device : LissabonDevice, noblePeripheral? : Peripheral) {
    // generate a unique id for the accessory this should be generated from
    // something globally unique, but constant, for example, the device serial
    // number or MAC address
    const uuid = this.api.hap.uuid.generate(device.address);

    if (this.handlers.has(uuid)) {
      // Seen again in this run (mDNS reports a service once per network interface). Refresh what
      // discovery learned, such as the IP address; the handler shares the context.device object.
      const accessory = this.accessories.find(accessory => accessory.UUID === uuid)!;
      Object.assign(accessory.context.device, device);
      this.log.debug('Already handling accessory:', accessory.displayName);
      return;
    }

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

      // the cached context may be stale (older plugin version, changed capabilities), use what discovery found
      existingAccessory.context.device = device;
      this.api.updatePlatformAccessories([existingAccessory]);

      // create the accessory handler for the restored accessory
      this.handlers.set(uuid, this.createHandler(existingAccessory, device, noblePeripheral));
    } else {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', device);

      // create a new accessory
      const accessory = new this.api.platformAccessory(device.name, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;

      // create the accessory handler for the newly create accessory
      this.handlers.set(uuid, this.createHandler(accessory, device, noblePeripheral));

      // link the accessory to your platform, and remember it so a second discovery doesn't register it again
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  createHandler(accessory : PlatformAccessory, device : LissabonDevice, noblePeripheral? : Peripheral) : LissabonAccessoryHandler {
    if (device.isBluetooth) {
      return new LissabonBlePlatformAccessory(this, accessory, noblePeripheral as Peripheral);
    }
    return new LissabonWiFiPlatformAccessory(this, accessory);
  }
}

import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { LissabonPlatformAccessory } from './platformAccessory';
import { LissabonConfig, LissabonOptions } from './config';
import mdns from 'mdns';
import noble from '@abandonware/noble';

const bleLissabonService = '6b2f000138bc4204a5061d3546ad3688';
const bleLissabonCharacteristic_isOn = '6b2f000238bc4204a5061d3546ad3688';
const bleLissabonCharacteristic_identify = '6b2f000338bc4204a5061d3546ad3688';
const bleLissabonCharacteristic_brightness = '6b2f000438bc4204a5061d3546ad3688';
const bleLissabonCharacteristic_temperature = '6b2f005238bc4204a5061d3546ad3688';
/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class LissabonHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  private options! : LissabonOptions;

  constructor(
    public readonly log: Logger,
    public readonly config: LissabonConfig,
    public readonly api: API,
  ) {
    if (!config || !config.options) {
      this.log.error('No configuration options found');
      return;
    }
    this.options = config.options;
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    if (this.options.discoverWifi) {
      this.api.on('didFinishLaunching', () => {
        log.debug('Executed didFinishLaunching callback, mDNS-discover');
        // run the method to discover / register your devices as accessories
        this.discoverWifiDevices();
      });
    } else if (this.options.discoverBle) {
      this.api.on('didFinishLaunching', () => {
        log.debug('Executed didFinishLaunching callback, BLE-discover');
        // run the method to discover / register your devices as accessories
        this.discoverBleDevices();
      });

    } else {
      this.api.on('didFinishLaunching', () => {
        log.debug('Executed didFinishLaunching callback, register');
        // run the method to discover / register your devices as accessories
        this.registerDevices();
      });
    }

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
    try {
      const browser = mdns.createBrowser(mdns.tcp('http'));
      browser.on('serviceUp', service => {
        this.mdnsServiceUp(service);
      });
      browser.on('serviceDown', service => {
        this.mdnsServiceDown(service);
      });
      browser.start();
    } catch(ex) {
      this.log.error('mdns.start exception: ', ex);
    }
  }

  mdnsServiceUp(service) {
    this.log.info('xxxjack serviceUp', service);
  }

  mdnsServiceDown(service) {
    this.log.info('xxxjack serviceDown', service);
  }

  discoverBleDevices() {
    const wantedServiceUuids = [bleLissabonService];
    noble.on('stateChange', async (state) => {
      if (state === 'poweredOn') {
        await noble.startScanningAsync(wantedServiceUuids, false);

      }
    });
    noble.on('discover', this.blePeripheralDiscovered.bind(this));
  }

  async blePeripheralDiscovered(peripheral) {
    if (!peripheral || !peripheral.advertisement) {
      return;
    }
    if (!peripheral.advertisement.serviceUuids) {
      return;
    }
    if (peripheral.advertisement.serviceUuids.indexOf(bleLissabonService) < 0) {
      return;
    }
    this.log.info('xxxjack peripheralDiscovered ', peripheral.address, ' name ', peripheral.advertisement.localName);
    this.log.info('   advertisement: ', peripheral.advertisement);
    try {
      await peripheral.connectAsync();
      const wtdServices = [bleLissabonService];
      const wtdCharacteristics = [bleLissabonCharacteristic_isOn, bleLissabonCharacteristic_brightness, bleLissabonCharacteristic_temperature];
      const {services, characteristics} = await peripheral.discoverSomeServicesAndCharacteristicsAsync(wtdServices, wtdCharacteristics);
      this.log.info('xxxjack services: ', services);
      this.log.info('xxxjack characteristics: ', characteristics);
    } catch(error) {
      this.log.error('discoverServices error: ', error);
    }
  }

  registerDevices() {


    // loop over the discovered devices and register each one if it has not already been registered
    if (!this.options || !this.options.devices) {
      this.log.warn('No devices configured');
      return;
    }
    for (const device of this.options.devices) {

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.address);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new LissabonPlatformAccessory(this, existingAccessory);

        // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
        // remove platform accessories when no longer present
        // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
        // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.address, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new LissabonPlatformAccessory(this, accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}

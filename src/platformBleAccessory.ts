import { Logger, Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';

import { LissabonDevice } from './config';

import noble from '@abandonware/noble';


export const bleLissabonService = '6b2f000138bc4204a5061d3546ad3688';
export const bleLissabonCharacteristic_isOn = '6b2f000238bc4204a5061d3546ad3688';
export const bleLissabonCharacteristic_brightness = '6b2f000438bc4204a5061d3546ad3688';
export const bleLissabonCharacteristic_temperature = '6b2f005238bc4204a5061d3546ad3688';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LissabonBlePlatformAccessory {
  private service: Service;
  private device : LissabonDevice;
  private noblePeripheral? : noble.Peripheral;
  private log : Logger;
  private cached_isOn = false;
  private cached_brightness = 0;
  private cached_temperature = 0;

  constructor(
    private readonly platform: LissabonHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly _noblePeripheral : noble.Peripheral,
  ) {
    this.device = accessory.context.device;
    this.noblePeripheral = _noblePeripheral;
    this.log = platform.log;
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'jackjansen')
      .setCharacteristic(this.platform.Characteristic.Model, this.device.type)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.address);

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this));               // GET - bind to the `getOn` method below

    if(this.device.hasBrightness) {
      // register handlers for the Brightness Characteristic
      this.service.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(this.setBrightness.bind(this))       // SET - bind to the 'setBrightness` method below
        .onGet(this.getBrightness.bind(this));
    }

    if(this.device.hasTemperature) {
      // register handlers for the ColorTemperature Characteristic
      this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
        .onSet(this.setTemperature.bind(this))       // SET - bind to the 'setBrightness` method below
        .onGet(this.getTemperature.bind(this));
    }
  }

  initDevice() : boolean {
    if (this.noblePeripheral === undefined) {
      // xxxjack should re-discover.
      this.log.error('[' + this.device.name + '] BLE Peripheral ' + this.device.address + ' not BLE-discovered yet');
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    if (this.noblePeripheral.state !== 'disconnected') {
      this.log.warn('[' + this.device.name + '] BLE Peripheral ' + this.device.address + ' in state ' + this.noblePeripheral.state);
      return false;
    }
   
    return true;
  }

  async connectPeripheral(char : string) : Promise<noble.Characteristic|undefined> {
    if(!this.initDevice()) {
      return undefined;
    }
    this.log.debug('[' + this.device.name + '] ' + this.device.address, 'state=', this.noblePeripheral!.state);
    await this.noblePeripheral!.connectAsync();
    const { characteristics } = await this.noblePeripheral!.discoverSomeServicesAndCharacteristicsAsync(
        [bleLissabonService],
        [char]);
    if (characteristics.length === 0) {
      this.log.error('[' + this.device.name + '] BLE-Characteristic' + char + ' not found for peripheral ');
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return characteristics[0];
  }

  async writePeripheralCharacteristic(lissabonCh : string, buf: Buffer) : Promise<boolean> {
    
    try {
      const ch = await this.connectPeripheral(lissabonCh);
      if (ch === undefined) {
        return false;
      }
      await ch.writeAsync(buf, false);
      this.log.debug('Disconnecting...');
      await this.noblePeripheral!.disconnectAsync();
      this.log.debug('Disconnected.');
    } catch(error) {
      this.log.error('BLE Error: ', error, 'state=', this.noblePeripheral!.state);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return true;
  }

  async ReadPeripheralCharacteristic(lissabonCh : string) : Promise<Buffer|undefined> {
    
    let buf : Buffer;
    try {
      const ch = await this.connectPeripheral(lissabonCh);
      if (ch === undefined) {
        return undefined;
      }
      buf = await ch.readAsync();
      this.log.debug('Disconnecting...');
      await this.noblePeripheral!.disconnectAsync();
      this.log.debug('Disconnected.');
    } catch(error) {
      this.log.error('BLE Error: ', error, 'state=', this.noblePeripheral!.state);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return buf;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {
    this.log.debug('[' + this.device.name + '] SetOn(' + value + ')');
    const buf : Buffer = Buffer.alloc(1);
    buf[0] = value as number;
    await this.writePeripheralCharacteristic(bleLissabonCharacteristic_isOn, buf);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getOn(): Promise<CharacteristicValue> {
    this.log.debug('[' + this.device.name + '] GetOn()');
    const buf = await this.ReadPeripheralCharacteristic(bleLissabonCharacteristic_isOn);
    if (buf !== undefined) {
      if (buf.byteLength !== 1) {
        this.log.error(`Unexpected length ${buf.byteLength} for BLE read of isOn characteristic`);
      }
      this.cached_isOn = buf[0] !== 0;
      this.log.debug('[' + this.device.name + '] GetOn() isOn=', this.cached_isOn);
    }
    return this.cached_isOn;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setBrightness(value: CharacteristicValue) {
    this.log.debug('[' + this.device.name + '] SetBrightness(' + value + ')');
    const buf : Buffer = Buffer.alloc(2);
    const v = value as number;
    buf[0] = v & 0xff;
    buf[1] = v >> 8;
    await this.writePeripheralCharacteristic(bleLissabonCharacteristic_brightness, buf);
  }

  async getBrightness(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    this.log.debug('[' + this.device.name + '] GetBrightness()');
    const buf = await this.ReadPeripheralCharacteristic(bleLissabonCharacteristic_brightness);
    if (buf !== undefined) {
      if (buf.byteLength !== 2) {
        this.log.warn(`Unexpected length ${buf.byteLength} for BLE read of brightness characteristic`);
      }
      this.cached_brightness = buf[0] | (buf[1] << 8);
      this.log.debug('[' + this.device.name + '] GetBrightness() brightness=', this.cached_brightness);
    }
    return this.cached_brightness;
  }

  async setTemperature(value: CharacteristicValue) {
    this.log.debug('[' + this.device.name + '] SetTemperature(' + value + ')');
    const buf : Buffer = Buffer.alloc(2);
    const v = value as number;
    buf[0] = v & 0xff;
    buf[1] = v >> 8;
    await this.writePeripheralCharacteristic(bleLissabonCharacteristic_temperature, buf);  
  }

  async getTemperature(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    this.log.debug('[' + this.device.name + '] GetTemperature()');
    const buf = await this.ReadPeripheralCharacteristic(bleLissabonCharacteristic_temperature);
    if (buf !== undefined) {
      if (buf.byteLength !== 2) {
        this.log.warn(`Unexpected length ${buf.byteLength} for BLE read of temperature characteristic`);
      }
      this.cached_temperature = buf[0] | (buf[1] << 8);
      this.log.debug('[' + this.device.name + '] GetTemperature() temperature=', this.cached_temperature);
    }
    return this.cached_temperature;
  }
}

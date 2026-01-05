import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

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

  constructor(
    private readonly platform: LissabonHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly _noblePeripheral : noble.Peripheral,
  ) {
    this.device = accessory.context.device;
    this.noblePeripheral = _noblePeripheral;
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

  async initDevice() : Promise<boolean> {
    if (this.noblePeripheral === undefined) {
      // xxxjack should re-discover.
      this.platform.log.error('Peripheral ' + this.device.address + ' not BLE-discovered yet');
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
   
    return true;
  }

  async connectPeripheral(char : string) : Promise<noble.Characteristic> {
    if (this.noblePeripheral === undefined) {
      this.platform.log.error('Peripheral ' + this.device.address + ' not BLE-discovered yet');
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.platform.log.debug('Connecting to peripheral ' + this.device.address, 'state=', this.noblePeripheral.state);
    await this.noblePeripheral.connectAsync();
    const { characteristics } = await this.noblePeripheral.discoverSomeServicesAndCharacteristicsAsync(
        [bleLissabonService],
        [char]);
    if (characteristics.length === 0) {
      this.platform.log.error('Characteristic ' + char + ' not found for peripheral ' + this.device.address);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return characteristics[0];
  }

  async writePeripheralCharacteristic(lissabonCh : string, buf: Buffer) : Promise<void> {
    if (this.noblePeripheral === undefined) {
      this.platform.log.error('Peripheral ' + this.device.address + ' not BLE-discovered yet');
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    try {
      const ch = await this.connectPeripheral(lissabonCh);
      await ch.writeAsync(buf, false);
      await this.noblePeripheral.disconnectAsync();
    } catch(error) {
      this.platform.log.debug('BLE Error: ', error, 'state=', this.noblePeripheral.state);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async ReadPeripheralCharacteristic(lissabonCh : string) : Promise<Buffer> {
    if (this.noblePeripheral === undefined) {
      this.platform.log.error('Peripheral ' + this.device.address + ' not BLE-discovered yet');
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    let buf : Buffer;
    try {
      const ch = await this.connectPeripheral(lissabonCh);
      buf = await ch.readAsync();
      await this.noblePeripheral.disconnectAsync();
    } catch(error) {
      this.platform.log.debug('BLE Error: ', error, 'state=', this.noblePeripheral.state);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return buf;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {
    await this.initDevice();
    this.platform.log.info('SetOn() ', value, ' to ', this.device.address);
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
    await this.initDevice();
    let isOn = false;
    this.platform.log.debug('GetOn()');
    const buf = await this.ReadPeripheralCharacteristic(bleLissabonCharacteristic_isOn);
    if (buf.byteLength !== 1) {
      this.platform.log.warn(`Unexpected length ${buf.byteLength} for BLE read of isOn characteristic`);
    }
    isOn = buf[0] !== 0;
    this.platform.log.debug('GetOn() isOn=', isOn);
    return isOn;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setBrightness(value: CharacteristicValue) {
    await this.initDevice();
    this.platform.log.info('SetBrightness() ', value, ' to ', this.device.address);
    const buf : Buffer = Buffer.alloc(2);
    const v = value as number;
    buf[0] = v & 0xff;
    buf[1] = v >> 8;
    await this.writePeripheralCharacteristic(bleLissabonCharacteristic_brightness, buf);
  }

  async getBrightness(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    let brightness = 0;
    this.platform.log.debug('GetBrightness()');
    const buf = await this.ReadPeripheralCharacteristic(bleLissabonCharacteristic_brightness);
    if (buf.byteLength !== 2) {
      this.platform.log.warn(`Unexpected length ${buf.byteLength} for BLE read of brightness characteristic`);
    }
    brightness = buf[0] | (buf[1] << 8);
    return brightness;
  }

  async setTemperature(value: CharacteristicValue) {
    this.platform.log.info('Set Characteristic Temperature ->', value, ' to ', this.device.address);
    const buf : Buffer = Buffer.alloc(2);
    const v = value as number;
    buf[0] = v & 0xff;
    buf[1] = v >> 8;
    await this.writePeripheralCharacteristic(bleLissabonCharacteristic_temperature, buf);  
  }

  async getTemperature(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    let temperature = 0;
    this.platform.log.debug('GetTemperature()');
    const buf = await this.ReadPeripheralCharacteristic(bleLissabonCharacteristic_temperature);
    if (buf.byteLength !== 2) {
      this.platform.log.warn(`Unexpected length ${buf.byteLength} for BLE read of temperature characteristic`);
    }
    temperature = buf[0] | (buf[1] << 8);
    return temperature;
  }
}

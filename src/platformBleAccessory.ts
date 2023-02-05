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
  private peripheral : noble.Peripheral;

  constructor(
    private readonly platform: LissabonHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly noblePeripheral : noble.Peripheral,
    private ble_isOn? : noble.Characteristic,
    private ble_brightness? : noble.Characteristic,
    private ble_temperature? : noble.Characteristic,
  ) {
    this.device = accessory.context.device;
    this.peripheral = noblePeripheral;
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

  async connectPeripheral() {
    await this.peripheral.connectAsync();
    if (this.ble_isOn === undefined) {
      const { characteristics } = await this.peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [bleLissabonService],
        [
          bleLissabonCharacteristic_isOn,
          bleLissabonCharacteristic_brightness,
          bleLissabonCharacteristic_temperature,
        ]);
      for(const ch of characteristics) {
        if (ch.uuid === bleLissabonCharacteristic_isOn) {
          this.ble_isOn = ch;
        }
        if (ch.uuid === bleLissabonCharacteristic_brightness) {
          this.ble_brightness = ch;
        }
        if (ch.uuid === bleLissabonCharacteristic_temperature) {
          this.ble_temperature = ch;
        }
      }
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {

    this.platform.log.info('Set Characteristic On ->', value, ' to ', this.device.address);
    try {
      await this.connectPeripheral();
      const ch = this.ble_isOn as noble.Characteristic;
      const buf : Buffer = Buffer.alloc(1);
      buf[0] = value as number;
      await ch.writeAsync(buf, false);
      this.peripheral.disconnect();
    } catch(error) {
      this.platform.log.debug('BLE Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
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
    // implement your own code to check if the device is on
    let isOn = false;
    try {
      await this.connectPeripheral();
      const ch = this.ble_isOn as noble.Characteristic;
      const buf = await ch.readAsync();
      if (buf.byteLength !== 1) {
        this.platform.log.warn(`Unexpected length ${buf.byteLength} for BLE read of isOn characteristic`);
      }
      isOn = buf[0] !== 0;
      this.peripheral.disconnect();
    } catch(error) {
      this.platform.log.debug('BLE Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return isOn;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setBrightness(value: CharacteristicValue) {
    // implement your own code to set the brightness

    this.platform.log.info('Set Characteristic Brightness -> ', value, ' to ', this.device.address);
    try {
      await this.connectPeripheral();
      const ch = this.ble_brightness as noble.Characteristic;
      const buf : Buffer = Buffer.alloc(2);
      const v = value as number;
      buf[0] = v & 0xff;
      buf[1] = v >> 8;
      await ch.writeAsync(buf, false);
      this.peripheral.disconnect();
    } catch(error) {
      this.platform.log.debug('BLE Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getBrightness(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    let brightness = 0;
    try {
      await this.connectPeripheral();
      const ch = this.ble_brightness as noble.Characteristic;
      const buf = await ch.readAsync();
      if (buf.byteLength !== 2) {
        this.platform.log.warn(`Unexpected length ${buf.byteLength} for BLE read of isOn characteristic`);
      }
      brightness = buf[0] | (buf[1] << 8);
      this.peripheral.disconnect();
    } catch(error) {
      this.platform.log.debug('BLE Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return brightness;
  }

  async setTemperature(value: CharacteristicValue) {
    // implement your own code to set the brightness

    this.platform.log.info('Set Characteristic Temperature -> ', value, ' to ', this.device.address);
    try {
      await this.connectPeripheral();
      const ch = this.ble_temperature as noble.Characteristic;
      const buf : Buffer = Buffer.alloc(2);
      const v = value as number;
      buf[0] = v & 0xff;
      buf[1] = v >> 8;
      await ch.writeAsync(buf, false);
      this.peripheral.disconnect();
    } catch(error) {
      this.platform.log.debug('BLE Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getTemperature(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    let temperature = 0;
    try {
      await this.connectPeripheral();
      const ch = this.ble_temperature as noble.Characteristic;
      const buf = await ch.readAsync();
      if (buf.byteLength !== 2) {
        this.platform.log.warn(`Unexpected length ${buf.byteLength} for BLE read of isOn characteristic`);
      }
      temperature = buf[0] | (buf[1] << 8);
      this.peripheral.disconnect();
    } catch(error) {
      this.platform.log.debug('BLE Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return temperature;
  }
}

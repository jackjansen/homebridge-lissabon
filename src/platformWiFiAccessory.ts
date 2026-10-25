import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';

import { LissabonDevice } from './config';
import { LampLog } from './lampLog';

import axios from 'axios';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LissabonWiFiPlatformAccessory {
  private service: Service;
  private device : LissabonDevice;
  private lampLog : LampLog;

  constructor(
    private readonly platform: LissabonHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.device = accessory.context.device;
    this.lampLog = new LampLog(platform.log, this.device.name, 'wifi');
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'jackjansen')
      .setCharacteristic(this.platform.Characteristic.Model, 'Lissabon Dimmer')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '0000');

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

  apiUrl() : string {
    return `http://${this.device.ipAddress ?? this.device.address}/api/${this.device.type}`;
  }

  async put(what : string, body : object, value : CharacteristicValue) {
    const t0 = Date.now();
    try {
      await axios.put(this.apiUrl(), body);
    } catch(error) {
      this.lampLog.failed('set', what, error, t0);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.lampLog.set(what, value, t0);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get(what : string) : Promise<any> {
    try {
      const { data } = await axios.get(this.apiUrl());
      return data;
    } catch(error) {
      this.lampLog.failed('get', what, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {
    await this.put('On', { isOn: value as boolean }, value);
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
    const t0 = Date.now();
    const data = await this.get('On');
    const isOn = data.isOn;
    this.lampLog.get('On', isOn, t0);
    return isOn;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setBrightness(value: CharacteristicValue) {
    await this.put('Brightness', { level: (value as number) / 100.0 }, value);
  }

  async getBrightness(): Promise<CharacteristicValue> {
    const t0 = Date.now();
    const data = await this.get('Brightness');
    const brightness = Math.round(data.level * 100);
    this.lampLog.get('Brightness', brightness, t0);
    return brightness;
  }

  async setTemperature(value: CharacteristicValue) {
    await this.put('ColorTemperature', { temperature: Math.round(1000000.0 / (value as number)) }, value);
  }

  async getTemperature(): Promise<CharacteristicValue> {
    const t0 = Date.now();
    const data = await this.get('ColorTemperature');
    // HomeKit wants an integer number of mireds, between 140 and 500
    const temperature = Math.min(500, Math.max(140, Math.round(1000000.0 / data.temperature)));
    this.lampLog.get('ColorTemperature', temperature, t0);
    return temperature;
  }
}

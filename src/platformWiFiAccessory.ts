import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';

import { LissabonDevice } from './config';

import axios from 'axios';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LissabonWiFiPlatformAccessory {
  private service: Service;
  private device : LissabonDevice;

  constructor(
    private readonly platform: LissabonHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.device = accessory.context.device;
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

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {

    this.platform.log.info('Set Characteristic On ->', value, ' to ', this.device.address);
    try {
      await axios.put(
        `http://${this.device.address}/api/${this.device.type}`,
        {
          isOn: value as boolean,
        },
      );

    } catch(error) {
      this.platform.log.debug('Error: ', error);
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

    try {
      const { data } = await axios.get(`http://${this.device.address}/api/${this.device.type}`);
      const isOn = data.isOn;
      this.platform.log.info('Get Characteristic On ->', isOn, ' from ', this.device.address);

      // if you need to return an error to show the device as "Not Responding" in the Home app:
      // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

      return isOn;
    } catch(error) {
      this.platform.log.debug('Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setBrightness(value: CharacteristicValue) {
    // implement your own code to set the brightness

    this.platform.log.info('Set Characteristic Brightness -> ', value, ' to ', this.device.address);
    try {
      await axios.put(
        `http://${this.device.address}/api/${this.device.type}`,
        {
          level: (value as number) / 100.0,
        },
      );

    } catch(error) {
      this.platform.log.debug('Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getBrightness(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on

    try {
      const { data } = await axios.get(`http://${this.device.address}/api/${this.device.type}`);
      const brightness = Math.round(data.level * 100);
      this.platform.log.info('Get Characteristic Brightness ->', brightness, ' from ', this.device.address);

      // if you need to return an error to show the device as "Not Responding" in the Home app:
      // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

      return brightness;
    } catch(error) {
      this.platform.log.debug('Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setTemperature(value: CharacteristicValue) {
    // implement your own code to set the brightness

    this.platform.log.info('Set Characteristic Temperature -> ', value, ' to ', this.device.address);
    try {
      await axios.put(
        `http://${this.device.address}/api/${this.device.type}`,
        {
          temperature: 1000000.0 / (value as number),
        },
      );

    } catch(error) {
      this.platform.log.debug('Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getTemperature(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on

    try {
      const { data } = await axios.get(`http://${this.device.address}/api/${this.device.type}`);
      const temperature = 1000000.0 / data.temperature;
      this.platform.log.info('Get Characteristic Temperature ->', temperature, ' from ', this.device.address);

      // if you need to return an error to show the device as "Not Responding" in the Home app:
      // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

      return temperature;
    } catch(error) {
      this.platform.log.debug('Error: ', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}

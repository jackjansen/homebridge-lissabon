import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';

import { LissabonDevice } from './config';
import { LampLog } from './lampLog';

import { Peripheral, Characteristic as NobleCharacteristic } from '@stoprocent/noble';


export const bleLissabonService = '6b2f000138bc4204a5061d3546ad3688';
export const bleLissabonCharacteristic_isOn = '6b2f000238bc4204a5061d3546ad3688';
export const bleLissabonCharacteristic_brightness = '6b2f000438bc4204a5061d3546ad3688';
export const bleLissabonCharacteristic_temperature = '6b2f000538bc4204a5061d3546ad3688';

// The firmware's brightness is uint16 (0..65535), HomeKit's is a percentage
const bleBrightnessMax = 65535;
// The firmware's temperature is in Kelvin, HomeKit's in mireds, with this range
const homekitMiredsMin = 140;
const homekitMiredsMax = 500;

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class LissabonBlePlatformAccessory {
  private service: Service;
  private device : LissabonDevice;
  private noblePeripheral? : Peripheral;
  private lampLog : LampLog;
  private cached_isOn = false;
  private cached_brightness = 0;
  private cached_temperature = 250; // mireds, the firmware's default of 4000K

  constructor(
    private readonly platform: LissabonHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly _noblePeripheral : Peripheral,
  ) {
    this.device = accessory.context.device;
    this.noblePeripheral = _noblePeripheral;
    this.lampLog = new LampLog(platform.log, this.device.name, 'ble');
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

  // Why the peripheral can't be used now, or undefined if it can
  unusableReason() : string | undefined {
    if (this.noblePeripheral === undefined) {
      // xxxjack should re-discover.
      return 'not BLE-discovered yet';
    }
    if (this.noblePeripheral.state !== 'disconnected') {
      return 'peripheral busy (' + this.noblePeripheral.state + ')';
    }
    return undefined;
  }

  async connectPeripheral(char : string) : Promise<NobleCharacteristic> {
    const t0 = Date.now();
    await this.noblePeripheral!.connectAsync();
    this.lampLog.debug('connected', t0);
    const { characteristics } = await this.noblePeripheral!.discoverSomeServicesAndCharacteristicsAsync(
      [bleLissabonService],
      [char]);
    if (characteristics.length === 0) {
      throw new Error('characteristic ' + char + ' not found');
    }
    return characteristics[0];
  }

  async disconnectPeripheral() {
    const t0 = Date.now();
    await this.noblePeripheral!.disconnectAsync();
    this.lampLog.debug('disconnected', t0);
  }

  async writePeripheralCharacteristic(what : string, lissabonCh : string, buf: Buffer, value : CharacteristicValue) {
    const t0 = Date.now();
    const reason = this.unusableReason();
    if (reason !== undefined) {
      // Report the failure, so HomeKit doesn't assume the write happened
      this.lampLog.failed('set', what, reason);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    try {
      const ch = await this.connectPeripheral(lissabonCh);
      await ch.writeAsync(buf, false);
      await this.disconnectPeripheral();
    } catch(error) {
      this.lampLog.failed('set', what, error, t0);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    this.lampLog.set(what, value, t0);
  }

  // Returns undefined if the peripheral is busy: the caller then answers from its cached value
  async readPeripheralCharacteristic(what : string, lissabonCh : string, expectedLength : number) : Promise<Buffer|undefined> {
    const t0 = Date.now();
    const reason = this.unusableReason();
    if (reason !== undefined) {
      if (this.noblePeripheral === undefined) {
        this.lampLog.failed('get', what, reason);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
      this.lampLog.debug('get ' + what + ': ' + reason + ', using cached value');
      return undefined;
    }
    let buf : Buffer;
    try {
      const ch = await this.connectPeripheral(lissabonCh);
      buf = await ch.readAsync();
      await this.disconnectPeripheral();
    } catch(error) {
      this.lampLog.failed('get', what, error, t0);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    if (buf.byteLength !== expectedLength) {
      this.lampLog.info('get ' + what + ': unexpected length ' + buf.byteLength + ', expected ' + expectedLength);
    }
    return buf;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {
    const buf : Buffer = Buffer.alloc(1);
    buf[0] = value ? 1 : 0;
    await this.writePeripheralCharacteristic('On', bleLissabonCharacteristic_isOn, buf, value);
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
    const buf = await this.readPeripheralCharacteristic('On', bleLissabonCharacteristic_isOn, 1);
    if (buf !== undefined) {
      this.cached_isOn = buf[0] !== 0;
      this.lampLog.get('On', this.cached_isOn, t0);
    }
    return this.cached_isOn;
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  async setBrightness(value: CharacteristicValue) {
    const buf : Buffer = Buffer.alloc(2);
    buf.writeUInt16LE(Math.round((value as number) * bleBrightnessMax / 100));
    await this.writePeripheralCharacteristic('Brightness', bleLissabonCharacteristic_brightness, buf, value);
  }

  async getBrightness(): Promise<CharacteristicValue> {
    const t0 = Date.now();
    const buf = await this.readPeripheralCharacteristic('Brightness', bleLissabonCharacteristic_brightness, 2);
    if (buf !== undefined) {
      this.cached_brightness = Math.round((buf[0] | (buf[1] << 8)) * 100 / bleBrightnessMax);
      this.lampLog.get('Brightness', this.cached_brightness, t0);
    }
    return this.cached_brightness;
  }

  async setTemperature(value: CharacteristicValue) {
    const buf : Buffer = Buffer.alloc(2);
    buf.writeUInt16LE(Math.round(1000000 / (value as number)));
    await this.writePeripheralCharacteristic('ColorTemperature', bleLissabonCharacteristic_temperature, buf, value);
  }

  async getTemperature(): Promise<CharacteristicValue> {
    const t0 = Date.now();
    const buf = await this.readPeripheralCharacteristic('ColorTemperature', bleLissabonCharacteristic_temperature, 2);
    if (buf !== undefined) {
      const kelvin = buf[0] | (buf[1] << 8);
      if (kelvin > 0) {
        this.cached_temperature = Math.min(homekitMiredsMax, Math.max(homekitMiredsMin, Math.round(1000000 / kelvin)));
      }
      this.lampLog.get('ColorTemperature', this.cached_temperature, t0);
    }
    return this.cached_temperature;
  }
}

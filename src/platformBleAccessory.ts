import { PlatformAccessory } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';
import { LissabonLampAccessory, LampValues, LampValueName, kelvinToMireds, miredsToKelvin } from './lampAccessory';

import { Peripheral, Characteristic as NobleCharacteristic } from '@stoprocent/noble';


export const bleLissabonService = '6b2f000138bc4204a5061d3546ad3688';
export const bleLissabonCharacteristic_isOn = '6b2f000238bc4204a5061d3546ad3688';
export const bleLissabonCharacteristic_brightness = '6b2f000438bc4204a5061d3546ad3688';
export const bleLissabonCharacteristic_temperature = '6b2f000538bc4204a5061d3546ad3688';

// The firmware's brightness is uint16 (0..65535), HomeKit's is a percentage
const bleBrightnessMax = 65535;

const characteristicFor : Record<LampValueName, string> = {
  isOn: bleLissabonCharacteristic_isOn,
  brightness: bleLissabonCharacteristic_brightness,
  temperature: bleLissabonCharacteristic_temperature,
};

/**
 * A lamp reached over BLE, through the lissabon GATT service. Every read or write is a separate
 * connection: connect, discover, read or write, disconnect.
 */
export class LissabonBlePlatformAccessory extends LissabonLampAccessory {
  constructor(
    platform: LissabonHomebridgePlatform,
    accessory: PlatformAccessory,
    private readonly noblePeripheral : Peripheral | undefined,
    pollIntervalSeconds : number,
  ) {
    super(platform, accessory, 'ble', pollIntervalSeconds);
  }

  // Connect, find the wanted characteristics, run body, and always disconnect
  private async withCharacteristics<T>(uuids : string[], body : (chars : NobleCharacteristic[]) => Promise<T>) : Promise<T> {
    const peripheral = this.noblePeripheral;
    if (peripheral === undefined) {
      // xxxjack should re-discover.
      throw new Error('not BLE-discovered yet');
    }
    if (peripheral.state !== 'disconnected') {
      throw new Error('peripheral busy (' + peripheral.state + ')');
    }
    const t0 = Date.now();
    await peripheral.connectAsync();
    this.lampLog.debug('connected', t0);
    try {
      const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync([bleLissabonService], uuids);
      return await body(characteristics);
    } finally {
      const t1 = Date.now();
      await peripheral.disconnectAsync();
      this.lampLog.debug('disconnected', t1);
    }
  }

  protected async readValues() : Promise<LampValues> {
    const wanted = [bleLissabonCharacteristic_isOn];
    if (this.device.hasBrightness) {
      wanted.push(bleLissabonCharacteristic_brightness);
    }
    if (this.device.hasTemperature) {
      wanted.push(bleLissabonCharacteristic_temperature);
    }
    return this.withCharacteristics(wanted, async chars => {
      const values : LampValues = {};
      for (const ch of chars) {
        const buf = await ch.readAsync();
        if (ch.uuid === bleLissabonCharacteristic_isOn && buf.length >= 1) {
          values.isOn = buf[0] !== 0;
        } else if (ch.uuid === bleLissabonCharacteristic_brightness && buf.length >= 2) {
          values.brightness = Math.round(buf.readUInt16LE(0) * 100 / bleBrightnessMax);
        } else if (ch.uuid === bleLissabonCharacteristic_temperature && buf.length >= 2) {
          const kelvin = buf.readUInt16LE(0);
          if (kelvin > 0) {
            values.temperature = kelvinToMireds(kelvin);
          }
        } else {
          this.lampLog.info('get: unexpected length ' + buf.length + ' for characteristic ' + ch.uuid);
        }
      }
      if (values.isOn === undefined) {
        throw new Error('isOn characteristic not found');
      }
      return values;
    });
  }

  protected async writeValue(what : LampValueName, value : number | boolean) {
    let buf : Buffer;
    switch (what) {
    case 'isOn':
      buf = Buffer.alloc(1);
      buf[0] = value ? 1 : 0;
      break;
    case 'brightness':
      buf = Buffer.alloc(2);
      buf.writeUInt16LE(Math.round((value as number) * bleBrightnessMax / 100));
      break;
    case 'temperature':
      buf = Buffer.alloc(2);
      buf.writeUInt16LE(miredsToKelvin(value as number));
      break;
    }
    await this.withCharacteristics([characteristicFor[what]], async chars => {
      if (chars.length === 0) {
        throw new Error('characteristic ' + characteristicFor[what] + ' not found');
      }
      await chars[0].writeAsync(buf, false);
    });
  }
}

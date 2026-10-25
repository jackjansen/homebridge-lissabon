import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';

import { LissabonDevice } from './config';
import { LampLog, Transport } from './lampLog';

// Lamp values in HomeKit units: brightness in percent, temperature in mireds
export type LampValues = {
  isOn? : boolean;
  brightness? : number;
  temperature? : number;
};
export type LampValueName = keyof LampValues;

// HomeKit's ColorTemperature range, in mireds
export const homekitMiredsMin = 140;
export const homekitMiredsMax = 500;

export function kelvinToMireds(kelvin : number) : number {
  return Math.min(homekitMiredsMax, Math.max(homekitMiredsMin, Math.round(1000000 / kelvin)));
}

export function miredsToKelvin(mireds : number) : number {
  return Math.round(1000000 / mireds);
}

// How long after a write the lamp is read back, to catch side effects (e.g. off also turning off the aux dimmer)
const readBackDelayMs = 2000;

/**
 * Common part of a lamp accessory: HomeKit reads are answered from cached state, HomeKit writes go into
 * a write queue, and the lamp is polled in the background (Decided 2 and 9 in #1). Reads and writes for
 * one lamp happen one at a time. Subclasses implement readValues() and writeValue() for their transport.
 */
export abstract class LissabonLampAccessory {
  protected readonly service : Service;
  protected readonly device : LissabonDevice;
  protected readonly lampLog : LampLog;
  private readonly cached = { isOn: false, brightness: 0, temperature: 250 }; // 250 mireds: the firmware's default of 4000K
  private readonly pending = new Map<LampValueName, number | boolean>(); // the write queue: latest value per characteristic
  private refreshWanted = false;
  private haveValues = false; // false until the first successful read, so the defaults aren't reported as changes
  private running = false;
  private stopped = false;
  private pollTimer? : NodeJS.Timeout;
  private readBackTimer? : NodeJS.Timeout;

  constructor(
    protected readonly platform : LissabonHomebridgePlatform,
    protected readonly accessory : PlatformAccessory,
    transport : Transport,
    pollIntervalSeconds : number,
  ) {
    this.device = accessory.context.device;
    this.lampLog = new LampLog(platform.log, this.device.name, transport);
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'jackjansen')
      .setCharacteristic(this.platform.Characteristic.Model, this.device.type)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.hostname);

    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(value => this.enqueue('isOn', value as boolean))
      .onGet(() => this.cached.isOn);
    if (this.device.hasBrightness) {
      this.service.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(value => this.enqueue('brightness', value as number))
        .onGet(() => this.cached.brightness);
    }
    if (this.device.hasTemperature) {
      this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
        .onSet(value => this.enqueue('temperature', value as number))
        .onGet(() => this.cached.temperature);
    }

    // Not directly: subclass constructor fields (such as the BLE peripheral) are only set after this constructor returns
    setImmediate(() => this.requestRefresh());
    this.pollTimer = setInterval(() => this.requestRefresh(), pollIntervalSeconds * 1000);
  }

  // Read all values the lamp has. Throws on failure.
  protected abstract readValues() : Promise<LampValues>;

  // Write one value to the lamp. Throws on failure.
  protected abstract writeValue(what : LampValueName, value : number | boolean) : Promise<void>;

  // Called when another handler takes over this accessory
  stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearTimeout(this.readBackTimer);
  }

  private enqueue(what : LampValueName, value : number | boolean) {
    // HomeKit gets its answer at once; the cached state follows the write, the read-back corrects it if needed
    (this.cached[what] as number | boolean) = value;
    this.pending.delete(what); // re-insert, so the queue keeps the order of the latest writes
    this.pending.set(what, value);
    void this.run();
  }

  private requestRefresh() {
    this.refreshWanted = true;
    void this.run();
  }

  private async run() {
    if (this.running || this.stopped) {
      return;
    }
    this.running = true;
    try {
      while (!this.stopped && (this.pending.size > 0 || this.refreshWanted)) {
        if (this.pending.size > 0) {
          const [what, value] = this.pending.entries().next().value!;
          this.pending.delete(what);
          await this.doWrite(what, value);
        } else {
          this.refreshWanted = false;
          await this.doRefresh();
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async doWrite(what : LampValueName, value : number | boolean) {
    const t0 = Date.now();
    try {
      await this.writeValue(what, value);
      this.lampLog.set(what, value, t0);
    } catch(error) {
      this.lampLog.failed('set', what, error, t0);
    }
    // Read back after a write, also after a failed one, so HomeKit shows what the lamp really does
    clearTimeout(this.readBackTimer);
    this.readBackTimer = setTimeout(() => this.requestRefresh(), readBackDelayMs);
  }

  private async doRefresh() {
    const t0 = Date.now();
    let values : LampValues;
    try {
      values = await this.readValues();
    } catch(error) {
      this.lampLog.failed('get', 'values', error, t0);
      // Shows the lamp as "No Response" until a refresh succeeds
      const status = new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(status);
      return;
    }
    this.lampLog.debug('get ' + JSON.stringify(values), t0);
    this.update('isOn', values.isOn, this.platform.Characteristic.On);
    this.update('brightness', values.brightness, this.platform.Characteristic.Brightness);
    this.update('temperature', values.temperature, this.platform.Characteristic.ColorTemperature);
    this.haveValues = true;
  }

  // Store a value read from the lamp and tell HomeKit, unless a newer write for it is still queued
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private update(what : LampValueName, value : number | boolean | undefined, characteristic : any) {
    if (value === undefined || this.pending.has(what)) {
      return;
    }
    if (this.haveValues && this.cached[what] !== value) {
      this.lampLog.info(`changed ${what} = ${value}`);
    }
    (this.cached[what] as number | boolean) = value;
    this.service.updateCharacteristic(characteristic, value as CharacteristicValue);
  }
}

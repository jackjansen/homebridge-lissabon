import { Service, PlatformAccessory, CharacteristicValue, WithUUID, Characteristic } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';
import { LampContext } from './config';
import { LampLog } from './lampLog';
import { DeviceValues, LampTransport, TransportKind, describeCapabilities } from './transport';

// HomeKit's ColorTemperature range, in mireds
const homekitMiredsMin = 140;
const homekitMiredsMax = 500;

function kelvinToMireds(kelvin : number) : number {
  return Math.min(homekitMiredsMax, Math.max(homekitMiredsMin, Math.round(1000000 / kelvin)));
}

function miredsToKelvin(mireds : number) : number {
  return Math.round(1000000 / mireds);
}

// Lamp values in HomeKit units: brightness in percent, temperature in mireds
type HomeKitValues = { isOn : boolean; brightness : number; temperature : number };
type HomeKitValueName = keyof HomeKitValues;

// How long after a write the lamp is read back, to catch side effects (e.g. off also turning off the aux dimmer)
const readBackDelayMs = 2000;

// After this many consecutive failures the lamp switches to its other transport, if it has one (Decided 3 in #1)
const switchAfterFailures = 2;

/**
 * One lamp as a HomeKit Lightbulb. HomeKit reads are answered from cached state, HomeKit writes go into a
 * write queue, and the lamp is polled in the background (Decided 2 and 9 in #1). Reads and writes for one
 * lamp happen one at a time, over the current transport. The lamp keeps every transport that has found it,
 * and sticks to the one in use until it fails (Decided 3).
 *
 * Control flow. The platform creates one of these per lamp and hands it transports (addTransport); after
 * that, HomeKit requests never pass through the platform. The constructor registers onSet/onGet callbacks
 * on this accessory's own characteristics (addHandlers), bound to this object. When the Home app (or the
 * Homebridge UI, also a HomeKit client) sets a characteristic, Homebridge calls that callback:
 *
 *   onSet -> set()           update the cache, queue the value, return at once
 *         -> run()           not awaited; works through the queue one item at a time
 *         -> doWrite()       picks this.transports.get(this.current), converts HomeKit to device units
 *         -> transport.writeValue()   IotsaRestTransport (HTTP PUT) or LissabonBleTransport (connect, write, disconnect)
 *
 * onGet only returns the cached value. The lamp itself is read by doRefresh(), from the poll timer and from
 * the read-back timer that every write starts.
 */
export class LissabonLampAccessory {
  private readonly service : Service;
  private readonly context : LampContext;
  private readonly transports = new Map<TransportKind, LampTransport>();
  private current? : TransportKind;
  private consecutiveFailures = 0;
  private reachable = false;
  private readonly cached : HomeKitValues = { isOn: false, brightness: 0, temperature: 250 }; // 250 mireds: the firmware's default of 4000K
  private readonly pending = new Map<HomeKitValueName, number | boolean>(); // the write queue: latest value per characteristic
  private refreshWanted = false;
  private running = false;
  private stopped = false;
  private haveValues = false; // false until the first successful read, so the defaults aren't reported as changes
  private hasBrightnessHandlers = false;
  private hasTemperatureHandlers = false;
  private pollTimer? : NodeJS.Timeout;
  private readBackTimer? : NodeJS.Timeout;

  constructor(
    private readonly platform : LissabonHomebridgePlatform,
    readonly accessory : PlatformAccessory,
    private readonly pollIntervalSeconds : Record<TransportKind, number>,
  ) {
    this.context = accessory.context.device;
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'jackjansen')
      .setCharacteristic(this.platform.Characteristic.Model, this.context.type)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.context.hostname);

    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.context.name);
    this.addHandlers('isOn', this.platform.Characteristic.On);
    this.addCapabilityHandlers();
  }

  // For a lamp restored from the cache, until a transport finds it
  showNotFoundYet() {
    this.log().info('not found yet, HomeKit shows it as No Response');
    this.showUnreachable();
  }

  // Log lines are labelled with the transport in use
  private log() : LampLog {
    return new LampLog(this.platform.log, this.context.name, this.current ?? 'none');
  }

  private failure() {
    return new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private addHandlers(what : HomeKitValueName, characteristic : WithUUID<new () => Characteristic>) {
    this.service.getCharacteristic(characteristic)
      .onSet(value => this.set(what, value))
      .onGet(() => this.get(what));
  }

  // Capabilities only grow: a transport that finds brightness or temperature adds those characteristics
  private addCapabilityHandlers() {
    if (this.context.hasBrightness && !this.hasBrightnessHandlers) {
      this.addHandlers('brightness', this.platform.Characteristic.Brightness);
      this.hasBrightnessHandlers = true;
    }
    if (this.context.hasTemperature && !this.hasTemperatureHandlers) {
      this.addHandlers('temperature', this.platform.Characteristic.ColorTemperature);
      this.hasTemperatureHandlers = true;
    }
  }

  // Called by discovery whenever a transport finds this lamp (again)
  addTransport(transport : LampTransport) {
    const known = this.transports.has(transport.kind);
    this.transports.set(transport.kind, transport); // a newer one may have a new address
    if ((transport.capabilities.hasLevel && !this.context.hasBrightness) ||
        (transport.capabilities.hasTemperature && !this.context.hasTemperature)) {
      this.context.hasBrightness ||= transport.capabilities.hasLevel;
      this.context.hasTemperature ||= transport.capabilities.hasTemperature;
      this.addCapabilityHandlers();
      // Save the grown capabilities in the accessory cache
      this.platform.api.updatePlatformAccessories([this.accessory]);
    }
    if (this.current === undefined) {
      this.useTransport(transport.kind, 'found');
    } else if (!known && this.current !== transport.kind) {
      this.log().info(`also reachable over ${transport.kind} (${transport.describe()}), staying on ${this.current}`);
    }
  }

  private useTransport(kind : TransportKind, why : string) {
    this.current = kind;
    this.consecutiveFailures = 0;
    this.reachable = true;
    const transport = this.transports.get(kind)!;
    this.log().info(`using ${transport.describe()}, ${describeCapabilities(transport.capabilities)}, ${why}`);
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.requestRefresh(), this.pollIntervalSeconds[kind] * 1000);
    this.requestRefresh();
  }

  // Called when the accessory is removed
  stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    clearTimeout(this.readBackTimer);
  }

  private get(what : HomeKitValueName) : CharacteristicValue {
    if (!this.reachable) {
      throw this.failure();
    }
    return this.cached[what];
  }

  private set(what : HomeKitValueName, value : CharacteristicValue) {
    if (this.current === undefined) {
      this.log().failed('set', what, 'lamp not reachable');
      throw this.failure();
    }
    // HomeKit gets its answer at once; the cached state follows the write, the read-back corrects it if needed
    (this.cached[what] as number | boolean) = value as number | boolean;
    this.pending.delete(what); // re-insert, so the queue keeps the order of the latest writes
    this.pending.set(what, value as number | boolean);
    void this.run();
  }

  private requestRefresh() {
    this.refreshWanted = true;
    void this.run();
  }

  private async run() {
    if (this.running || this.stopped || this.current === undefined) {
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

  private async doWrite(what : HomeKitValueName, value : number | boolean) {
    const transport = this.transports.get(this.current!)!;
    const t0 = Date.now();
    try {
      switch (what) {
      case 'isOn':
        await transport.writeValue('isOn', value as boolean);
        break;
      case 'brightness':
        await transport.writeValue('level', (value as number) / 100);
        break;
      case 'temperature':
        await transport.writeValue('temperature', miredsToKelvin(value as number));
        break;
      }
      this.log().set(what, value, t0);
      this.noteResult(true);
    } catch(error) {
      this.log().failed('set', what, error, t0);
      this.noteResult(false);
    }
    // Read back after a write, also after a failed one, so HomeKit shows what the lamp really does
    clearTimeout(this.readBackTimer);
    this.readBackTimer = setTimeout(() => this.requestRefresh(), readBackDelayMs);
  }

  private async doRefresh() {
    const transport = this.transports.get(this.current!)!;
    const t0 = Date.now();
    let values : DeviceValues;
    try {
      values = await transport.readValues();
    } catch(error) {
      this.log().failed('get', 'values', error, t0);
      this.noteResult(false);
      return;
    }
    this.log().debug('get ' + JSON.stringify(values), t0);
    this.noteResult(true);
    this.update('isOn', values.isOn, this.platform.Characteristic.On);
    if (values.level !== undefined) {
      this.update('brightness', Math.round(values.level * 100), this.platform.Characteristic.Brightness);
    }
    if (values.temperature !== undefined && values.temperature > 0) {
      this.update('temperature', kelvinToMireds(values.temperature), this.platform.Characteristic.ColorTemperature);
    }
    this.haveValues = true;
  }

  private noteResult(ok : boolean) {
    if (ok) {
      this.consecutiveFailures = 0;
      if (!this.reachable) {
        this.log().info('reachable again');
        this.reachable = true;
      }
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures < switchAfterFailures) {
      return;
    }
    const other : TransportKind = this.current === 'wifi' ? 'ble' : 'wifi';
    if (this.transports.has(other)) {
      this.useTransport(other, `after ${this.consecutiveFailures} failures over ${this.current}`);
    } else if (this.reachable) {
      this.log().warn('not reachable, HomeKit shows it as No Response');
      this.reachable = false;
      this.showUnreachable();
    }
  }

  // Tell subscribers (the Home app) now, instead of waiting for their next read
  private showUnreachable() {
    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.failure());
  }

  // Store a value read from the lamp and tell HomeKit, unless a newer write for it is still queued
  private update(what : HomeKitValueName, value : number | boolean | undefined, characteristic : WithUUID<new () => Characteristic>) {
    if (value === undefined || this.pending.has(what)) {
      return;
    }
    if (this.haveValues && this.cached[what] !== value) {
      this.log().info(`changed ${what} = ${value}`);
    }
    (this.cached[what] as number | boolean) = value;
    this.service.updateCharacteristic(characteristic, value as CharacteristicValue);
  }
}

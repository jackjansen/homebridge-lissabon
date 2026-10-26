import noble, { Peripheral, Characteristic as NobleCharacteristic } from '@stoprocent/noble';

import { Capabilities, DeviceValueName, DeviceValues, LampTransport } from './transport';
import { LampLog, reasonText } from './lampLog';
import { runExclusive } from './bleQueue';

export const bleLissabonService = '6b2f000138bc4204a5061d3546ad3688';
const bleLissabonCharacteristic_isOn = '6b2f000238bc4204a5061d3546ad3688';
const bleLissabonCharacteristic_brightness = '6b2f000438bc4204a5061d3546ad3688';
const bleLissabonCharacteristic_temperature = '6b2f000538bc4204a5061d3546ad3688';

// The firmware's brightness is uint16 (0..65535), the transport's level is 0..1
const bleBrightnessMax = 65535;

// A connect that takes longer is cancelled and counts as a failure. Well above a sleeping lamp's wake-up
// time (kaars: 3.5 s sleep); without it a hanging connect (once 114 s) blocks the lamp, and all BLE lamps.
const connectTimeoutMs = 15000;
// Limits for the steps after connecting, so nothing in a BLE operation can block the queue forever
const operationTimeoutMs = 15000;
const disconnectTimeoutMs = 5000;

// Reject when p doesn't settle within ms; onTimeout runs first
function withTimeout<T>(p : Promise<T>, ms : number, what : string, onTimeout : () => void) : Promise<T> {
  let timer : NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`${what} timed out after ${ms} ms`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const characteristicFor : Record<DeviceValueName, string> = {
  isOn: bleLissabonCharacteristic_isOn,
  level: bleLissabonCharacteristic_brightness,
  temperature: bleLissabonCharacteristic_temperature,
};

/**
 * A lamp reached over BLE, through the lissabon GATT service. Every read or write is a separate
 * connection: connect, discover, read or write, disconnect.
 */
export class LissabonBleTransport implements LampTransport {
  readonly kind = 'ble';

  constructor(
    private readonly peripheral : Peripheral,
    readonly capabilities : Capabilities,
    private readonly lampLog : LampLog,
  ) {}

  // Connect to a lamp found by scanning and see which characteristics it has; undefined if it has no isOn
  static async probe(peripheral : Peripheral, lampLog : LampLog) : Promise<Capabilities | undefined> {
    const uuids = await new LissabonBleTransport(peripheral, { hasLevel: false, hasTemperature: false }, lampLog).withCharacteristics(
      Object.values(characteristicFor),
      async chars => chars.map(ch => ch.uuid),
    );
    if (!uuids.includes(bleLissabonCharacteristic_isOn)) {
      return undefined;
    }
    return {
      hasLevel: uuids.includes(bleLissabonCharacteristic_brightness),
      hasTemperature: uuids.includes(bleLissabonCharacteristic_temperature),
    };
  }

  describe() : string {
    // macOS doesn't give the address, only a per-host id
    return 'id ' + (this.peripheral.address || this.peripheral.id);
  }

  // Connect, find the wanted characteristics, run body, and always disconnect. One BLE operation at a time,
  // plugin-wide.
  private withCharacteristics<T>(uuids : string[], body : (chars : NobleCharacteristic[]) => Promise<T>) : Promise<T> {
    return runExclusive(() => this.withCharacteristicsNow(uuids, body));
  }

  private async withCharacteristicsNow<T>(uuids : string[], body : (chars : NobleCharacteristic[]) => Promise<T>) : Promise<T> {
    const peripheral = this.peripheral;
    // noble leaves the state at 'error' after a failed connect; that peripheral can be connected again
    if (peripheral.state !== 'disconnected' && peripheral.state !== 'error') {
      throw new Error('peripheral busy (' + peripheral.state + ')');
    }
    const t0 = Date.now();
    // The timeouts are races that reject by themselves, independent of noble's peripheral state. A first
    // version that relied on peripheral.cancelConnect() once left a connect pending forever (and with it
    // every BLE lamp, through runExclusive); cause unknown, a later test showed cancelConnect() itself works.
    let abandoned = false;
    const connecting = peripheral.connectAsync();
    connecting.then(() => {
      // Connected after all, but nobody is waiting: disconnect, or the lamp stays connected and stops advertising
      if (abandoned) {
        void peripheral.disconnectAsync().catch(() => undefined);
      }
    }, () => undefined);
    await withTimeout(connecting, connectTimeoutMs, 'connect', () => {
      abandoned = true;
      noble.cancelConnect(peripheral.id);
    });
    this.lampLog.debug('connected', t0);
    try {
      return await withTimeout((async () => {
        const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync([bleLissabonService], uuids);
        return await body(characteristics);
      })(), operationTimeoutMs, 'read or write', () => undefined);
    } finally {
      const t1 = Date.now();
      try {
        await withTimeout(peripheral.disconnectAsync(), disconnectTimeoutMs, 'disconnect', () => undefined);
        this.lampLog.debug('disconnected', t1);
      } catch(error) {
        // Don't let a lost disconnect make the lamp look busy forever; the lamp's idle timeout ends the link
        this.lampLog.debug(reasonText(error), t1);
        (peripheral as { state : string }).state = 'disconnected';
      }
    }
  }

  async readValues() : Promise<DeviceValues> {
    const wanted = [bleLissabonCharacteristic_isOn];
    if (this.capabilities.hasLevel) {
      wanted.push(bleLissabonCharacteristic_brightness);
    }
    if (this.capabilities.hasTemperature) {
      wanted.push(bleLissabonCharacteristic_temperature);
    }
    return this.withCharacteristics(wanted, async chars => {
      const values : DeviceValues = {};
      for (const ch of chars) {
        const buf = await ch.readAsync();
        if (ch.uuid === bleLissabonCharacteristic_isOn && buf.length >= 1) {
          values.isOn = buf[0] !== 0;
        } else if (ch.uuid === bleLissabonCharacteristic_brightness && buf.length >= 2) {
          values.level = buf.readUInt16LE(0) / bleBrightnessMax;
        } else if (ch.uuid === bleLissabonCharacteristic_temperature && buf.length >= 2) {
          values.temperature = buf.readUInt16LE(0);
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

  async writeValue(what : DeviceValueName, value : number | boolean) {
    let buf : Buffer;
    switch (what) {
    case 'isOn':
      buf = Buffer.alloc(1);
      buf[0] = value ? 1 : 0;
      break;
    case 'level':
      buf = Buffer.alloc(2);
      buf.writeUInt16LE(Math.round((value as number) * bleBrightnessMax));
      break;
    case 'temperature':
      buf = Buffer.alloc(2);
      buf.writeUInt16LE(Math.round(value as number));
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

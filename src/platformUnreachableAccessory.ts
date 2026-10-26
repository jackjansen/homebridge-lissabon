import { PlatformAccessory } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';

import { LissabonDevice } from './config';
import { LampLog } from './lampLog';

/**
 * Handler for a cached accessory that no transport has found (yet) in this run.
 * HomeKit shows it as "No Response" until discovery replaces this handler.
 */
export class LissabonUnreachableAccessory {
  constructor(
    private readonly platform: LissabonHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const device : LissabonDevice = accessory.context.device;
    const service = this.accessory.getService(this.platform.Service.Lightbulb);
    if (service === undefined) {
      return;
    }
    const lampLog = new LampLog(platform.log, device.name, device.isBluetooth ? 'ble' : 'wifi');
    lampLog.info('not found yet, HomeKit shows it as No Response');
    const failure = () => new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    const unreachableGet = () => {
      throw failure();
    };
    const unreachableSet = (what : string) => () => {
      lampLog.failed('set', what, 'lamp not reachable');
      throw failure();
    };
    const on = service.getCharacteristic(this.platform.Characteristic.On).onGet(unreachableGet).onSet(unreachableSet('isOn'));
    // Tell subscribers (the Home app) now, instead of waiting for their next read
    on.updateValue(failure());
    if (device.hasBrightness) {
      service.getCharacteristic(this.platform.Characteristic.Brightness).onGet(unreachableGet).onSet(unreachableSet('brightness'));
    }
    if (device.hasTemperature) {
      service.getCharacteristic(this.platform.Characteristic.ColorTemperature).onGet(unreachableGet).onSet(unreachableSet('temperature'));
    }
  }

  stop() {
    // nothing running
  }
}

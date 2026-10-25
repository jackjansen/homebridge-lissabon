import { PlatformAccessory } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';

import { LissabonDevice } from './config';

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
    const unreachable = () => {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    };
    service.getCharacteristic(this.platform.Characteristic.On).onGet(unreachable).onSet(unreachable);
    if (device.hasBrightness) {
      service.getCharacteristic(this.platform.Characteristic.Brightness).onGet(unreachable).onSet(unreachable);
    }
    if (device.hasTemperature) {
      service.getCharacteristic(this.platform.Characteristic.ColorTemperature).onGet(unreachable).onSet(unreachable);
    }
  }
}

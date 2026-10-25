import { PlatformAccessory } from 'homebridge';

import { LissabonHomebridgePlatform } from './platform';
import { LissabonLampAccessory, LampValues, LampValueName, kelvinToMireds, miredsToKelvin } from './lampAccessory';

import axios from 'axios';

const requestTimeoutMs = 5000;

/**
 * A lamp reached over WiFi, through its REST API (/api/dimmer or /api/ledstrip).
 */
export class LissabonWiFiPlatformAccessory extends LissabonLampAccessory {
  constructor(
    platform: LissabonHomebridgePlatform,
    accessory: PlatformAccessory,
    pollIntervalSeconds : number,
  ) {
    super(platform, accessory, 'wifi', pollIntervalSeconds);
  }

  apiUrl() : string {
    return `http://${this.device.ipAddress ?? this.device.address}/api/${this.device.type}`;
  }

  protected async readValues() : Promise<LampValues> {
    const { data } = await axios.get(this.apiUrl(), { timeout: requestTimeoutMs });
    const values : LampValues = { isOn: data.isOn };
    if (this.device.hasBrightness) {
      values.brightness = Math.round(data.level * 100);
    }
    if (this.device.hasTemperature) {
      values.temperature = kelvinToMireds(data.temperature);
    }
    return values;
  }

  protected async writeValue(what : LampValueName, value : number | boolean) {
    let body : object;
    switch (what) {
    case 'isOn':
      body = { isOn: value as boolean };
      break;
    case 'brightness':
      body = { level: (value as number) / 100.0 };
      break;
    case 'temperature':
      body = { temperature: miredsToKelvin(value as number) };
      break;
    }
    await axios.put(this.apiUrl(), body, { timeout: requestTimeoutMs });
  }
}

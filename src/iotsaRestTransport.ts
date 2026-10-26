import axios from 'axios';

import { Capabilities, DeviceValueName, DeviceValues, LampTransport } from './transport';

const requestTimeoutMs = 5000;

/**
 * An iotsa device reached over WiFi, through the iotsa REST API of one of its modules (e.g. /api/dimmer).
 */
export class IotsaRestTransport implements LampTransport {
  readonly kind = 'wifi';

  constructor(
    private readonly address : string, // IPv4 address from mDNS (avoids slow .local lookups), or a configured hostname
    private readonly apiName : string,
    readonly capabilities : Capabilities,
  ) {}

  // Ask the lamp which values it has
  static async probe(address : string, apiName : string) : Promise<Capabilities> {
    const { data } = await axios.get(`http://${address}/api/${apiName}`, { timeout: requestTimeoutMs });
    return { hasLevel: data.level !== undefined, hasTemperature: data.temperature !== undefined };
  }

  describe() : string {
    return this.address;
  }

  private apiUrl() : string {
    return `http://${this.address}/api/${this.apiName}`;
  }

  async readValues() : Promise<DeviceValues> {
    const { data } = await axios.get(this.apiUrl(), { timeout: requestTimeoutMs });
    const values : DeviceValues = { isOn: data.isOn };
    if (this.capabilities.hasLevel) {
      values.level = data.level;
    }
    if (this.capabilities.hasTemperature) {
      values.temperature = data.temperature;
    }
    return values;
  }

  async writeValue(what : DeviceValueName, value : number | boolean) {
    await axios.put(this.apiUrl(), { [what]: value }, { timeout: requestTimeoutMs });
  }
}

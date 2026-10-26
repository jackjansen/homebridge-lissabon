// Transport layer (Decided 10 in #1): how the plugin talks to a lamp, without any HomeKit knowledge.

export type TransportKind = 'wifi' | 'ble';

// Lamp values in device units: level 0..1, temperature in Kelvin
export type DeviceValues = {
  isOn? : boolean;
  level? : number;
  temperature? : number;
};
export type DeviceValueName = keyof DeviceValues;

export type Capabilities = {
  hasLevel : boolean;
  hasTemperature : boolean;
};

export interface LampTransport {
  readonly kind : TransportKind;
  readonly capabilities : Capabilities;

  // Short description for log lines, such as the IP address or BLE id
  describe() : string;

  // Read all values the lamp has. Throws on failure.
  readValues() : Promise<DeviceValues>;

  // Write one value to the lamp. Throws on failure.
  writeValue(what : DeviceValueName, value : number | boolean) : Promise<void>;
}

export function describeCapabilities(capabilities : Capabilities) : string {
  let rv = 'on/off';
  if (capabilities.hasLevel) {
    rv += ', level';
  }
  if (capabilities.hasTemperature) {
    rv += ', temperature';
  }
  return rv;
}

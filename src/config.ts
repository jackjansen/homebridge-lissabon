import { PlatformConfig } from 'homebridge';

// What the accessory cache keeps about a lamp (accessory.context.device)
export type LampContext = {
    hostname : string; // identity of the lamp, the same over WiFi and BLE (iotsa advertises it as the BLE name)
    name : string;
    type : string; // the iotsa module, also the REST API name: dimmer or ledstrip
    hasBrightness : boolean;
    hasTemperature : boolean;
  };

export type LissabonOptions = {
    discoverWifi : boolean;
    discoverBle : boolean;
    wifiPollInterval? : number; // seconds between background reads of WiFi lamps
    blePollInterval? : number; // seconds between background reads of BLE lamps (each read wakes the lamp)
  };

  type Config = {
    options? : LissabonOptions;
  };

export type LissabonConfig = PlatformConfig & Config;

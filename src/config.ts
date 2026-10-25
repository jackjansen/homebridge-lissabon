import { PlatformConfig } from 'homebridge';

export type LissabonDevice = {
    hostname : string; // identity of the lamp, the same over WiFi and BLE (iotsa advertises it as the BLE name)
    address : string;
    name : string;
    type : string;
    hasBrightness : boolean;
    hasTemperature : boolean;
    isBluetooth : boolean;
    ipAddress? : string; // WiFi only: IPv4 address from mDNS, avoids slow .local lookups
    lastSeen? : number; // ms since epoch when a transport last found the lamp
  };

export type LissabonOptions = {
    discoverWifi : boolean;
    discoverBle : boolean;
    devices : LissabonDevice[];
  };

  type Config = {
    options? : LissabonOptions;
  };

export type LissabonConfig = PlatformConfig & Config;
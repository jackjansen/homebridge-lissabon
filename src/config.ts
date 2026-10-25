import { PlatformConfig } from 'homebridge';

export type LissabonDevice = {
    address : string;
    name : string;
    type : string;
    hasBrightness : boolean;
    hasTemperature : boolean;
    isBluetooth : boolean;
    ipAddress? : string; // WiFi only: IPv4 address from mDNS, avoids slow .local lookups
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
import { PlatformConfig } from 'homebridge';

export type LissabonDevice = {
    address : string;
    name : string;
    type : string;
    hasBrightness : boolean;
    hasTemperature : boolean;
    isBluetooth : boolean;
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
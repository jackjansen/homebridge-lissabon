import { PlatformConfig } from 'homebridge';

export type LissabonDevice = {
    address : string;
    name : string;
    type : string;
    hasBrightness : boolean;
    hasTemperature : boolean;
  };

export type LissabonOptions = {
    devices : LissabonDevice[];
  };

  type Config = {
    options? : LissabonOptions;
  };

export type LissabonConfig = PlatformConfig & Config;
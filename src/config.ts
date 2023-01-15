import { PlatformConfig } from 'homebridge';

export type LissabonDevice = {
    address : string;
    name : string;
  };

export type LissabonOptions = {
    devices : LissabonDevice[];
  };

  type Config = {
    options? : LissabonOptions;
  };

export type LissabonConfig = PlatformConfig & Config;
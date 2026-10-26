// Device model (Decided 10 in #1): which iotsa modules this plugin exposes to HomeKit, and as what.
// iotsa devices list their modules as TXT keys in their _iotsa._tcp mDNS record (e.g. dimmer=1);
// the module name is also the REST API endpoint (/api/dimmer). Only lamps for now (#2 is about others).

// iotsa modules exposed as a HomeKit Lightbulb
const lampModules = ['dimmer', 'ledstrip'];

// The lamp module a device has, from its mDNS TXT keys; undefined if it isn't a lamp
export function lampModuleFor(txtKeys : string[]) : string | undefined {
  return lampModules.find(module => txtKeys.includes(module));
}

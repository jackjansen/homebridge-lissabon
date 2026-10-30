# Changelog

## [2.0.0] - 2026-10-30

Rewrite, tested with lamps over WiFi and BLE on macOS and Raspberry Pi OS.

- One accessory per lamp, identified by hostname, with WiFi and BLE as interchangeable transports. **Lamps must be added to Home again** (#1)
- HomeKit is answered at once from a cache; lamps are polled in the background, and changes made elsewhere reach HomeKit (#1)
- Much more robust BLE: timeouts, one operation at a time, retries, scanning on Linux, and unreachable lamps show as No Response (#1)
- Runs on Homebridge 2 and Node 22/24, with `@stoprocent/noble` and `bonjour-service`; nothing to compile for mDNS any more (#1)
- Lamps come from discovery only: the `devices` setting is gone. New settings `wifiPollInterval` and `blePollInterval` (#1)
- A real README instead of the template's (#1)

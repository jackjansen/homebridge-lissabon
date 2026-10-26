// One BLE operation at a time, plugin-wide (stage 5 in #1). Each lamp already does one operation at a time,
// but without this, operations of different lamps (and discovery's probes) would overlap; some Linux
// bindings support only one pending connection.

let tail : Promise<unknown> = Promise.resolve();

// Run fn after every operation queued before it has finished, whether that succeeded or failed
export function runExclusive<T>(fn : () => Promise<T>) : Promise<T> {
  const result = tail.then(() => fn());
  tail = result.catch(() => undefined);
  return result;
}

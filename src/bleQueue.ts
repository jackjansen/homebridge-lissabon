// One BLE operation at a time, plugin-wide (stage 5 in #1). Each lamp already does one operation at a time,
// but without this, operations of different lamps (and discovery's probes) would overlap; some Linux
// bindings support only one pending connection.

let tail : Promise<unknown> = Promise.resolve();
let pending = 0;
let idleCallback : (() => void) | undefined;

// Called whenever the last queued operation has finished
export function setIdleCallback(callback : () => void) {
  idleCallback = callback;
}

export function isIdle() : boolean {
  return pending === 0;
}

// Run fn after every operation queued before it has finished, whether that succeeded or failed
export function runExclusive<T>(fn : () => Promise<T>) : Promise<T> {
  pending++;
  const result = tail.then(() => fn());
  tail = result.catch(() => undefined).finally(() => {
    pending--;
    if (pending === 0) {
      idleCallback?.();
    }
  });
  return result;
}

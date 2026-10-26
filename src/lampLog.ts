import { Logger } from 'homebridge';

export type Transport = 'wifi' | 'ble' | 'mdns' | 'none';

export function reasonText(reason: unknown) : string {
  if (reason instanceof Error) {
    return reason.message;
  }
  return String(reason);
}

/**
 * Uniform log lines for one lamp: "[lamp] transport message (duration)".
 * Sets, discovery results and failures are logged at info/warn level,
 * gets and connection steps at debug level (HomeKit polls a lot).
 */
export class LampLog {
  constructor(
    private readonly log: Logger,
    private readonly lamp: string,
    private readonly transport: Transport,
  ) {}

  get(what: string, value: unknown, t0: number) {
    this.log.debug(this.line(`get ${what} = ${value}`, t0));
  }

  set(what: string, value: unknown, t0: number) {
    this.log.info(this.line(`set ${what} = ${value}`, t0));
  }

  failed(op: 'get' | 'set', what: string, reason: unknown, t0?: number) {
    this.log.warn(this.line(`${op} ${what} failed: ${reasonText(reason)}`, t0));
  }

  warn(message: string, t0?: number) {
    this.log.warn(this.line(message, t0));
  }

  info(message: string, t0?: number) {
    this.log.info(this.line(message, t0));
  }

  debug(message: string, t0?: number) {
    this.log.debug(this.line(message, t0));
  }

  private line(message: string, t0?: number) : string {
    const duration = t0 === undefined ? '' : ` (${Date.now() - t0} ms)`;
    return `[${this.lamp}] ${this.transport} ${message}${duration}`;
  }
}

/**
 * Read-only enforcement.
 *
 * The guard is the runtime half of the security contract. TypeScript interfaces
 * are erased at compile time, so a cast or a raw client would bypass them.
 * A Proxy that throws on anything outside the read allowlist cannot be bypassed
 * at runtime without deliberately unwrapping the target.
 */

export class ReadOnlyViolation extends Error {
  readonly attempted: string;

  constructor(attempted: string, context?: string) {
    super(
      `Read-only violation: "${attempted}" is not permitted${context ? ` on ${context}` : ''}`,
    );
    this.name = 'ReadOnlyViolation';
    this.attempted = attempted;
  }
}

/**
 * Properties that must not throw, because runtimes probe them incidentally:
 * `await reader` reads `then`, `JSON.stringify` reads `toJSON`,
 * `console.log` reads `util.inspect.custom` (a symbol) and `inspect`.
 */
const PASSTHROUGH = new Set(['then', 'toJSON', 'inspect', 'constructor']);

export interface ReadOnlyGuardOptions {
  /** Name used in violation messages, e.g. "GitHubReader". */
  context?: string;
}

/**
 * Wrap a client so only the named methods are reachable.
 *
 * @param allowedMethods Exact property names that may be accessed.
 * @param options Context label for error messages.
 */
export function createReadOnlyGuard<T extends object>(
  allowedMethods: readonly string[],
  options: ReadOnlyGuardOptions = {},
): (target: T) => T {
  const allowed = new Set(allowedMethods);
  const { context } = options;

  return (target: T): T =>
    new Proxy(target, {
      get(obj, prop, _receiver) {
        if (typeof prop === 'symbol') {
          return Reflect.get(obj, prop, obj);
        }
        if (PASSTHROUGH.has(prop)) {
          return undefined;
        }
        if (!allowed.has(prop)) {
          throw new ReadOnlyViolation(prop, context);
        }
        const value = Reflect.get(obj, prop, obj);
        // Bind to the raw target so implementations do not re-enter the proxy
        // when they use `this`.
        return typeof value === 'function' ? value.bind(obj) : value;
      },
      set(_obj, prop) {
        throw new ReadOnlyViolation(String(prop), context);
      },
      deleteProperty(_obj, prop) {
        throw new ReadOnlyViolation(`delete ${String(prop)}`, context);
      },
      defineProperty(_obj, prop) {
        throw new ReadOnlyViolation(`define ${String(prop)}`, context);
      },
    });
}

type LogContext = Record<string, unknown>;
type Transport = (level: string, message: string, extra?: unknown) => void;

let transport: Transport | null = null;

const PREFIX = "[HE]";

function emit(level: string, message: string, extra?: unknown): void {
  if (transport) {
    transport(level, message, extra);
    return;
  }
  const args = extra !== undefined ? [extra] : [];
  if (level === "warn" || level === "error") {
    // warn e error saem sempre — também em produção sem transport
    const fn = level === "warn" ? console.warn : console.error;
    fn(PREFIX, message, ...args);
  } else if (import.meta.env.DEV) {
    // debug e info apenas em desenvolvimento
    if (level === "debug") console.log(PREFIX, message, ...args);
    else console.info(PREFIX, message, ...args);
  }
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    emit("debug", message, context);
  },
  info(message: string, context?: LogContext): void {
    emit("info", message, context);
  },
  warn(message: string, context?: LogContext): void {
    emit("warn", message, context);
  },
  error(message: string, error?: unknown, context?: LogContext): void {
    const extra =
      error !== undefined && context !== undefined
        ? { ...context, error }
        : error ?? context;
    emit("error", message, extra);
  },
  /** Substitui o transporte por defeito. Usar para integração futura com Sentry, LogRocket, etc. */
  setTransport(fn: Transport): void {
    transport = fn;
  },
};

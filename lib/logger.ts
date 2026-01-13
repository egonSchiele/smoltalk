import { EgonLog, LogLevel } from "egonlog";

let loggerInstance: EgonLog | null = null;
export function getLogger(level: LogLevel = "error"): EgonLog {
  if (loggerInstance) {
    return loggerInstance;
  }
  loggerInstance = new EgonLog({ level });
  return loggerInstance;
}

import { EgonLog, LogLevel } from "egonlog";

let loggerInstance: EgonLog | null = null;
export function getLogger(level: LogLevel = "error"): EgonLog {
  if (loggerInstance) {
    return loggerInstance;
  }
  console.log("Initializing new logger with level", level);
  loggerInstance = new EgonLog({ level });
  return loggerInstance;
}

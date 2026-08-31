import { defaultRuntimeEnvironmentPath, loadCentralServerConfig, loadEnvironmentFile } from "./config.js";
import { startCentralServer } from "./composition.js";

const runtimePath = process.env.TRACEFORGE_RUNTIME_ENV ?? defaultRuntimeEnvironmentPath();
loadEnvironmentFile(runtimePath);
const running = await startCentralServer(loadCentralServerConfig());
process.stdout.write(`${JSON.stringify({ level: "info", type: "server_started", url: running.url, runtimeEnvironment: runtimePath })}\n`);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`${JSON.stringify({ level: "info", type: "server_stopping", signal })}\n`);
  await running.stop();
}
process.once("SIGINT", () => { void shutdown("SIGINT").then(() => process.exit(0)); });
process.once("SIGTERM", () => { void shutdown("SIGTERM").then(() => process.exit(0)); });

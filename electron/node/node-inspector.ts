import os from "node:os";
import { type NodeProbeData } from "../../src/shared/node-capabilities";

/**
 * R43 Phase C (R-302): device self-inspection collector.
 * Produces a concrete NodeProbeData for this device from node:os/process plus
 * observed sources (logged-in web AI, native-tool availability). Optional
 * overrides keep deterministic tests independent of the host environment.
 */
export interface InspectDeviceOptions {
  nodeId?: string;
  /** Provider ids whose account probe observed READY (logged in). */
  loggedInProviderIds?: string[];
  nativeToolsAvailable?: boolean;
  browserVersion?: string;
}

export function inspectDevice(options: InspectDeviceOptions = {}): NodeProbeData {
  const cpus = os.cpus();
  return {
    nodeId: options.nodeId ?? "desktop",
    os: { platform: os.platform(), arch: os.arch(), version: os.release() },
    cpu: { cores: cpus.length, model: cpus[0]?.model, loadPercent: Math.round(os.loadavg()[0] ?? 0) },
    gpu: [],
    memory: { totalMb: Math.round(os.totalmem() / 1024 / 1024), freeMb: Math.round(os.freemem() / 1024 / 1024) },
    runtimes: { node: process.version, browser: options.browserVersion },
    webLoggedInProviders: [...new Set(options.loggedInProviderIds ?? [])],
    nativeToolsAvailable: options.nativeToolsAvailable ?? true,
    network: { directReachableProviders: [], proxyCapable: false },
    currentTaskCount: 0,
    sampledAt: new Date().toISOString()
  };
}

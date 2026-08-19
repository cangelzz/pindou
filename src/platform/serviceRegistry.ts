import type { PlatformServices } from "./services";

let platformServices: PlatformServices | null = null;

export function setPlatformServices(services: PlatformServices): void {
  platformServices = services;
}

export function getPlatformServices(): PlatformServices {
  if (!platformServices) {
    throw new Error("Platform services not initialized. Call setPlatformServices() first.");
  }
  return platformServices;
}

export function resetPlatformServicesForTest(): void {
  platformServices = null;
}

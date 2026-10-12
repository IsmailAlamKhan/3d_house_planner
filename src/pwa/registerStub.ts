/** Stand-in for the generated `virtual:pwa-register` module (unit tests have no service worker). */
export function registerSW(): (reload?: boolean) => Promise<void> {
  return async () => undefined;
}

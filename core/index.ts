export const HOMEBREW_ID = "eagle-homebrew";

export function logHomebrewReady(foundryVersion: string): void {
  console.log(`${HOMEBREW_ID} | ready (Foundry v${foundryVersion})`);
}

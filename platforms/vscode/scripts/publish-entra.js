/**
 * Publish VS Code extension using Microsoft Entra ID token via tfx-cli.
 * Requires: az cli (logged in), tfx-cli (npm i -g tfx-cli)
 *
 * Usage: npm run publish:entra
 */
const { execSync } = require("child_process");
const { version } = require("../package.json");

const vsix = `pindouverse-${version}.vsix`;

console.log(`\n=== Publishing ${vsix} via Entra ID ===\n`);

// Get Entra token via Azure CLI
console.log("Fetching Entra ID token...");
const token = execSync(
  "az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv"
).toString().trim();

if (!token) {
  console.error("Failed to get Entra token. Run 'az login' first.");
  process.exit(1);
}

console.log("Publishing to VS Code Marketplace...");
execSync(`tfx extension publish --vsix ${vsix} --auth-type pat -t ${token}`, {
  stdio: "inherit",
});

console.log("\nDone!");

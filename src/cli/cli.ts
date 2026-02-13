#!/usr/bin/env npx tsx

const command = process.argv[2];

if (command === "setup") {
  const { runSetup } = await import("./setup.js");
  await runSetup();
} else if (command === "start") {
  const { runStart } = await import("./start.js");
  await runStart();
} else {
  console.error("Switchboard Plugin CLI");
  console.error("");
  console.error("Usage:");
  console.error("  npx tsx src/cli/cli.ts setup   — First-time configuration wizard");
  console.error("  npx tsx src/cli/cli.ts start   — Connect to Switchboard server");
  process.exit(1);
}

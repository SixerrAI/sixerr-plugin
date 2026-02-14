#!/usr/bin/env npx tsx

async function main() {
  const command = process.argv[2];

  if (command === "setup") {
    const { runSetup } = await import("./setup.js");
    await runSetup();
  } else if (command === "start") {
    const { runStart } = await import("./start.js");
    await runStart();
  } else {
    console.error("Sixerr Plugin CLI");
    console.error("");
    console.error("Usage:");
    console.error("  sixerr setup   — First-time configuration wizard");
    console.error("  sixerr start   — Connect to Sixerr server");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

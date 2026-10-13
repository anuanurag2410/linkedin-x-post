const [major, minor] = process.versions.node
  .split(".")
  .map((value) => Number(value));

const supported = major > 22 || (major === 22 && minor >= 12);

if (!supported) {
  console.error("");
  console.error("Post Studio Desktop requires Node.js 22.12.0 or newer.");
  console.error(`Current Node.js: v${process.versions.node}`);
  console.error("");
  console.error("macOS (Homebrew):");
  console.error("  brew install node@22");
  console.error('  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"');
  console.error("");
  console.error("Then verify:");
  console.error("  node -v");
  console.error("");
  process.exit(1);
}

console.log(`Node.js v${process.versions.node} ✓`);

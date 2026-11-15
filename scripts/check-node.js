// Stops early, with a plain-English message, if Node.js is too old.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(
    `\nThis app needs Node.js 22.12 or newer. You have ${process.versions.node}.\n` +
      'Download the current "LTS" version from https://nodejs.org, install it, then try again.\n',
  );
  process.exit(1);
}

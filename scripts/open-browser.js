/**
 * Best-effort "open this URL in the default browser" for the login scripts.
 *
 * Never fails the caller, and always prints the URL: launchers like xdg-open can
 * report success without a usable browser (e.g. over SSH with no desktop), so the
 * user may need to open it by hand.
 */
const { spawn } = require('child_process');

function browserCommand(platform, url) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

function openBrowser(url) {
  console.log(`If no browser opens, open this URL on this machine: ${url}`);
  const { command, args } = browserCommand(process.platform, url);
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Nothing to do: the URL is already printed.
  }
}

module.exports = { browserCommand, openBrowser };

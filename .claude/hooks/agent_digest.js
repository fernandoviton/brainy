/**
 * SessionStart hook: summarise agent job reports since the last session on
 * this machine. Shown to the user (systemMessage) and given to the assistant
 * (additionalContext) so it can follow up. Never blocks session start: any
 * failure (no scheduler tables yet, offline) is silent and the marker is left
 * alone so nothing is skipped.
 */
const { buildDigest } = require('../../backend/agent-digest');

(async () => {
  try {
    const storage = require('../../backend/storage').getStorage();
    const message = await buildDigest({ listReports: storage.listReports });
    if (message) {
      process.stdout.write(JSON.stringify({
        systemMessage: message,
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message },
      }));
    }
  } catch (_) { /* silent: see header */ }
  process.exit(0);
})();

const { browserCommand } = require('../../scripts/open-browser');

const URL = 'http://localhost:3000';

describe('browserCommand', () => {
  test('Windows uses `start` via cmd', () => {
    expect(browserCommand('win32', URL)).toEqual({ command: 'cmd', args: ['/c', 'start', '""', URL] });
  });

  test('macOS uses `open`', () => {
    expect(browserCommand('darwin', URL)).toEqual({ command: 'open', args: [URL] });
  });

  test('Linux uses `xdg-open`', () => {
    expect(browserCommand('linux', URL)).toEqual({ command: 'xdg-open', args: [URL] });
  });
});

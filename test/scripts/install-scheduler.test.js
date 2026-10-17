const { renderUnits, unitDir } = require('../../scripts/install-scheduler');

const opts = { node: '/opt/node/bin/node', repo: '/home/u/brainy', home: '/home/u', pathEnv: '/usr/bin:/bin' };

describe('renderUnits', () => {
  const { service, timer } = renderUnits(opts);

  test('service runs one tick as a oneshot from the checkout', () => {
    expect(service).toContain('Type=oneshot');
    expect(service).toContain('WorkingDirectory=/home/u/brainy');
    expect(service).toContain('ExecStart=/opt/node/bin/node /home/u/brainy/backend/cli.js scheduler tick');
  });

  test('service PATH finds user-installed claude and node', () => {
    expect(service).toMatch(/^Environment=PATH=\/home\/u\/\.local\/bin:\/opt\/node\/bin:\/usr\/bin:\/bin$/m);
  });

  test('service has a start timeout so a wedged tick cannot block forever', () => {
    expect(service).toMatch(/^TimeoutStartSec=\d+h$/m);
  });

  test('timer fires every 15 minutes and catches up after downtime', () => {
    expect(timer).toContain('OnCalendar=*:0/15');
    expect(timer).toContain('Persistent=true');
    expect(timer).toContain('WantedBy=timers.target');
  });
});

describe('unitDir', () => {
  test('uses XDG_CONFIG_HOME when set', () => {
    expect(unitDir({ XDG_CONFIG_HOME: '/x' }, '/home/u')).toBe('/x/systemd/user');
  });

  test('defaults to ~/.config/systemd/user', () => {
    expect(unitDir({}, '/home/u')).toBe('/home/u/.config/systemd/user');
  });
});

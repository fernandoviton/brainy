const chart = require('../../../frontend/pt/pt-chart.js');

function day(date, extra) {
  return { date, morningRight: null, morningLeft: null, flares: 0, maxFlare: null, lift: false, liftNotes: '', exercises: 0, ...extra };
}

const days = [
  day('2026-11-08', { morningRight: 4, morningLeft: 2, lift: true }),
  day('2026-11-09'),
  day('2026-11-10', { morningRight: 6, morningLeft: 3, flares: 2, maxFlare: 7 }),
  day('2026-11-11', { morningRight: 3, morningLeft: 3 }),
];

describe('ptPainChartSvg', () => {
  const svg = chart.ptPainChartSvg(days, 340);

  test('breaks the line at a day with no morning log', () => {
    const rightPath = svg.match(/<path d="([^"]*)" fill="none" stroke="#C4652A"/)[1];
    expect(rightPath.match(/M/g)).toHaveLength(2);
  });

  test('shades lift days and labels both line ends', () => {
    expect(svg.match(/class="pt-lift"/g)).toHaveLength(1);
    expect(svg).toContain('>R 3<');
    expect(svg).toContain('>L 3<');
  });

  test('has one hit target per day', () => {
    expect(svg.match(/class="pt-hit"/g)).toHaveLength(4);
  });
});

describe('ptFlareChartSvg', () => {
  test('draws a bar only for days with flares', () => {
    const svg = chart.ptFlareChartSvg(days, 340);
    expect(svg.match(/class="pt-bar"/g)).toHaveLength(1);
  });
});

describe('ptDayTipText', () => {
  test('describes a day', () => {
    expect(chart.ptDayTipText(days[2])).toEqual(['2026-11-10', 'Morning R 6 · L 3', '2 flares (max 7)']);
    expect(chart.ptDayTipText({ ...days[0], liftNotes: 'squats' })).toContain('Lift: squats');
  });
});

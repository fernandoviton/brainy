const chart = require('../../../frontend/tracker/tracker-chart.js');

const settings = {
  areas: [{ id: 'right', label: 'Right knee' }, { id: 'left', label: 'Left knee' }, { id: 'back', label: 'Lower back' }],
  activities: [{ id: 'lift', label: 'Lift day' }],
  triggers: [{ id: 'car', label: 'Car' }],
};

function day(date, extra) {
  return { date, scores: { right: null, left: null, back: null }, worst: null, flares: 0, maxFlare: null, activities: {}, exercises: 0, ...extra };
}

const days = [
  day('2026-11-08', { scores: { right: 4, left: 2, back: 1 }, worst: 4, activities: { lift: 'squats' } }),
  day('2026-11-09'),
  day('2026-11-10', { scores: { right: 6, left: 3, back: 2 }, worst: 6, flares: 2, maxFlare: 7 }),
  day('2026-11-11', { scores: { right: 3, left: 3, back: 1 }, worst: 3 }),
];

describe('trkCheckinChartSvg', () => {
  const svg = chart.trkCheckinChartSvg(days, settings.areas, 340);

  test('draws one line per area in the fixed colour order', () => {
    chart.TRK_AREA_COLORS.slice(0, 3).forEach((c) => expect(svg).toContain(`stroke="${c}" stroke-width="2"`));
  });

  test('breaks a line at a day with no check-in', () => {
    const first = svg.match(new RegExp(`<path d="([^"]*)" fill="none" stroke="${chart.TRK_AREA_COLORS[0]}"`))[1];
    expect(first.match(/M/g)).toHaveLength(2);
  });

  test('shades activity days, labels line ends by first word, one hit target per day', () => {
    expect(svg.match(/class="trk-activity"/g)).toHaveLength(1);
    expect(svg).toContain('>Right 3<');
    expect(svg).toContain('>Lower 1<');
    expect(svg.match(/class="trk-hit"/g)).toHaveLength(4);
  });
});

describe('trkFlareChartSvg', () => {
  test('draws a bar only for days with flares', () => {
    expect(chart.trkFlareChartSvg(days, 340).match(/class="trk-bar"/g)).toHaveLength(1);
  });
});

describe('trkDayTipText', () => {
  test('describes a day with area labels and activity labels', () => {
    expect(chart.trkDayTipText(days[0], settings)).toEqual([
      '2026-11-08', 'Right knee 4 · Left knee 2 · Lower back 1', 'no flares', 'Lift day: squats',
    ]);
    expect(chart.trkDayTipText(days[1], settings)[1]).toBe('no check-in');
  });
});

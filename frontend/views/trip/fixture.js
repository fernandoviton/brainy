// Fake data for mock mode (localhost, no Supabase config) and the smoke test.
// Everything here is invented: this repo is public, so never paste a real
// plan, name, booking, price or place into it.
(function (root) {
  var ENTRY_PATH = 'sample/trips/demo-trip/planner.md';

  var PLAN = {
    schema: 1,
    trip: {
      title: 'Demo trip',
      start: '2030-05-06',
      end: '2030-05-12',
      knowledgePath: 'sample/trips/demo-trip.md',
      todo: 'plan-demo-trip',
      researchPrefixes: ['sample/trips/demo-trip'],
    },
    settings: { partySize: 4, rooms: 2, eurToUsd: 1.1, people: ['Alex', 'Sam'] },
    budget: {
      targets: [{ label: 'Comfortable', usdLow: 4000, usdHigh: 6000 }],
      estimates: [{ label: 'Meals', usdLow: 800, usdHigh: 1200, note: 'Rough guess' }],
      fixed: [{ label: 'Flights', usd: 2000 }],
    },
    travelers: [
      { id: 'us', name: 'Alex & Sam', count: 2, from: '2030-05-06', to: '2030-05-12', status: 'booked' },
      { id: 'friends', name: 'Friends', count: 2, from: '2030-05-08', to: '2030-05-12', status: 'likely' },
    ],
    places: [
      { id: 'port', name: 'Harbor City', lat: 45.0, lng: 5.9, kind: 'airport' },
      { id: 'lake', name: 'Lakeside', lat: 45.1, lng: 6.2, kind: 'town' },
      { id: 'hill', name: 'Hilltop', lat: 45.3, lng: 6.6, kind: 'town' },
    ],
    bases: [
      { id: 'lake', name: 'Lakeside', short: 'Lak', from: '2030-05-06', to: '2030-05-09', color: '#2e6f8e', placeId: 'lake', decisionId: 'lake-stay' },
      { id: 'hill', name: 'Hilltop', short: 'Hil', from: '2030-05-09', to: '2030-05-12', color: '#5b7f3a', placeId: 'hill' },
    ],
    legs: [
      { date: '2030-05-06', label: 'Arrive', path: ['port', 'lake'] },
      { date: '2030-05-09', label: 'Lakeside to Hilltop', path: ['lake', 'hill'], decisionId: 'transfer' },
    ],
    days: [
      { date: '2030-05-06', items: [{ slot: 'travel', title: 'Fly in, drive to Lakeside' }] },
      { date: '2030-05-07', items: [{ slot: 'am', title: 'Boat tour', status: 'idea' }, { slot: 'eve', title: 'Dinner by the water' }] },
      { date: '2030-05-09', items: [{ slot: 'travel', title: 'Transfer to Hilltop', decisionId: 'transfer' }] },
    ],
    decisions: [
      {
        id: 'lake-stay', title: 'Where to stay in Lakeside', category: 'lodging', dates: ['2030-05-06', '2030-05-08'],
        status: 'open', chosen: [], recommended: 'inn', nights: 3,
        question: 'Which place for the first three nights?', context: 'Both are **made up** for the demo.',
        agentTake: 'The inn is closer to the water.', refs: ['sample/trips/demo-trip/lodging.md'],
        options: [
          { id: 'inn', title: 'Example Inn', summary: 'Small inn on the shore.', pros: ['Walkable'], cons: ['Small rooms'],
            links: [{ label: 'Site', url: 'https://example.com/inn' }],
            cost: { low: 150, high: 180, currency: 'EUR', unit: 'room-night' }, budgetCategory: 'lodging',
            status: 'shortlisted', votes: { Alex: 1 }, lat: 45.11, lng: 6.21 },
          { id: 'villa', title: 'Sample Villa', summary: 'Villa up the hill.', pros: ['Pool'], cons: ['Need a car'],
            links: [], cost: { low: 400, high: 450, currency: 'EUR', unit: 'total', note: 'per night, whole villa' },
            budgetCategory: 'lodging', status: 'candidate', votes: {}, lat: 45.13, lng: 6.18 },
        ],
      },
      {
        id: 'transfer', title: 'Getting to Hilltop', category: 'transport', dates: ['2030-05-09'],
        status: 'leaning', chosen: [], recommended: 'train',
        options: [
          { id: 'train', title: 'Train', summary: 'Two changes.', pros: [], cons: [], links: [],
            cost: { low: 20, high: 30, currency: 'EUR', unit: 'person' }, budgetCategory: 'transport', status: 'candidate', votes: {} },
          { id: 'driver', title: 'Private driver', summary: 'Door to door.', pros: [], cons: [], links: [],
            cost: { low: 300, high: 350, currency: 'EUR', unit: 'vehicle' }, budgetCategory: 'transport', status: 'candidate', votes: { Sam: 1 } },
        ],
      },
      {
        id: 'shape', title: 'Trip shape', category: 'strategy', status: 'open', chosen: [], recommended: 'two-bases', excludeFromBudget: true,
        options: [
          { id: 'two-bases', title: 'Two bases', short: 'Plan A', summary: 'Lakeside then Hilltop.', votes: {}, status: 'candidate' },
          { id: 'one-base', title: 'One base', short: 'Plan B', summary: 'Stay in Lakeside all week.', votes: {}, status: 'candidate',
            scenario: {
              bases: [{ id: 'lake', name: 'Lakeside', short: 'Lak', from: '2030-05-06', to: '2030-05-12', color: '#2e6f8e', placeId: 'lake' }],
              days: [{ date: '2030-05-09', items: [{ slot: 'day', title: 'Day trip to Hilltop' }] }],
            } },
        ],
      },
    ],
    tasks: [
      { id: 't1', kind: 'deadline', title: 'Book the Lakeside stay', short: 'Book Lakeside', due: '2030-02-01', owner: 'Alex', decisionId: 'lake-stay', done: false },
      { id: 't2', kind: 'waiting', title: 'Friends to confirm dates', owner: 'Friends', done: false },
    ],
    notes: [
      { id: 'n1', kind: 'risk', title: 'Holiday weekend', body: 'Trains may be busy on the 9th.', decisionId: 'transfer' },
      { id: 'n2', kind: 'tip', title: 'Bring cash', body: 'Small shops may not take cards.' },
    ],
    comments: [
      { id: 'c1', decisionId: 'lake-stay', optionId: 'villa', who: 'Sam', text: 'Is there parking?', at: '2030-01-10T10:00:00.000Z', resolved: false },
    ],
    log: [{ at: '2030-01-10T10:00:00.000Z', who: 'Sam', text: 'commented on Sample Villa (Where to stay in Lakeside)' }],
  };

  var PREAMBLE = '# Demo trip planner data\n\nFake data for the trip planner\'s mock mode.\n\n';

  // Rows for the mock client's brainy_knowledge table.
  function rows() {
    var stamp = '2030-01-10T10:00:00.000Z';
    return [
      { path: ENTRY_PATH, topic: 'planner', summary: '', updated_at: stamp,
        content: PREAMBLE + '```json\n' + JSON.stringify(PLAN, null, 2) + '\n```\n' },
      { path: 'sample/trips/demo-trip.md', topic: 'demo-trip', summary: 'Demo trip overview', updated_at: stamp,
        content: '# Demo trip\n\nA made-up week between **Lakeside** and **Hilltop**.\n' },
      { path: 'sample/trips/demo-trip/lodging.md', topic: 'lodging', summary: 'Lodging research', updated_at: stamp,
        content: '# Lodging\n\n- Example Inn: on the shore\n- Sample Villa: up the hill\n' },
    ];
  }

  var api = { ENTRY_PATH: ENTRY_PATH, PLAN: PLAN, rows: rows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlannerFixture = api;
})(this);

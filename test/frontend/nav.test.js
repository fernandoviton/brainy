/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "http://localhost/brainy/views/trip/"}
 */
// The site nav injected by frontend/nav.js on every page.
const fs = require('fs');
const path = require('path');

function loadNav() {
  document.body.innerHTML = '<main></main>';
  Object.defineProperty(document, 'currentScript', {
    configurable: true,
    value: { src: 'http://localhost/brainy/nav.js' },
  });
  window.eval(fs.readFileSync(path.join(__dirname, '../../frontend/nav.js'), 'utf8'));
}

test('has a Trips link to the trip planner, marked active on that page', () => {
  loadNav();
  const trips = [...document.querySelectorAll('#brainy-nav a')].find((a) => a.textContent === 'Trips');
  expect(trips).toBeDefined();
  expect(trips.getAttribute('href')).toBe('http://localhost/brainy/views/trip/');
  expect(trips.className).toBe('active');
});

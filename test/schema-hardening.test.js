// Guards for defense-in-depth settings that live outside the JS code:
// the canonical schema and the deploy workflow.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const setupSql = fs.readFileSync(path.join(root, 'sql/setup.sql'), 'utf8');

const tables = [...setupSql.matchAll(/create table if not exists (brainy_\w+)/gi)].map(m => m[1]);

describe('sql/setup.sql', () => {
  test('defines brainy tables', () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  // RLS already hides every row from anon; revoking the grants means a table
  // whose policy is ever dropped or broken still refuses anonymous requests.
  test.each(tables)('%s revokes all privileges from anon', table => {
    expect(setupSql).toMatch(new RegExp(`revoke all on table ${table} from anon;`, 'i'));
  });
});

describe('deploy workflow', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-frontend.yml'), 'utf8');

  test('builds on a supported Node.js line (not the EOL 20.x)', () => {
    const versions = [...workflow.matchAll(/node-version:\s*['"]?(\d+)/g)].map(m => Number(m[1]));
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(v).toBeGreaterThanOrEqual(24);
  });
});

/**
 * Smoke test: verifies auth, CRUD on todos, and RLS isolation.
 * Run: node scripts/smoke-test.js
 */
const { supabase, login } = require('../lib/supabase-client');

const TEST_TODO = {
  name: `smoke-test-${Date.now()}`,
  summary: 'Temporary item created by smoke test',
  status: 'inbox',
  priority: 'P3',
  category: 'test',
};

async function run() {
  console.log('1. Authenticating...');
  const user = await login();
  console.log(`   Logged in as ${user.email} (${user.id})`);

  console.log('2. Inserting todo...');
  const { data: inserted, error: insertErr } = await supabase
    .from('brainy_todos')
    .insert({ ...TEST_TODO, user_id: user.id })
    .select()
    .single();
  if (insertErr) throw insertErr;
  console.log(`   Created: ${inserted.name} (id: ${inserted.id})`);

  console.log('3. Reading back...');
  const { data: fetched, error: fetchErr } = await supabase
    .from('brainy_todos')
    .select('*')
    .eq('id', inserted.id)
    .single();
  if (fetchErr) throw fetchErr;
  assert(fetched.name === TEST_TODO.name, 'name mismatch');
  assert(fetched.status === 'inbox', 'status mismatch');
  assert(fetched.user_id === user.id, 'user_id mismatch');
  console.log('   Read verified.');

  console.log('4. Updating...');
  const { data: updated, error: updateErr } = await supabase
    .from('brainy_todos')
    .update({ summary: 'Updated by smoke test', priority: 'P1' })
    .eq('id', inserted.id)
    .select()
    .single();
  if (updateErr) throw updateErr;
  assert(updated.summary === 'Updated by smoke test', 'summary not updated');
  assert(updated.priority === 'P1', 'priority not updated');
  assert(updated.updated_at > inserted.updated_at, 'updated_at not bumped');
  console.log('   Update verified.');

  console.log('5. RLS check (wrong user_id insert should fail)...');
  const fakeUserId = '00000000-0000-0000-0000-000000000000';
  const { error: rlsErr } = await supabase
    .from('brainy_todos')
    .insert({ name: 'rls-test', summary: 'should fail', user_id: fakeUserId, status: 'inbox' });
  assert(rlsErr !== null, 'RLS should have blocked insert with wrong user_id');
  console.log(`   RLS correctly blocked: ${rlsErr.message}`);

  console.log('6. Deleting test todo...');
  const { error: deleteErr } = await supabase
    .from('brainy_todos')
    .delete()
    .eq('id', inserted.id);
  if (deleteErr) throw deleteErr;

  const { data: gone } = await supabase
    .from('brainy_todos')
    .select('id')
    .eq('id', inserted.id)
    .single();
  assert(gone === null, 'todo should be deleted');
  console.log('   Delete verified.');

  console.log('\nAll smoke tests passed!');
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

run().catch((err) => {
  console.error('\nSmoke test FAILED:', err.message);
  process.exit(1);
});

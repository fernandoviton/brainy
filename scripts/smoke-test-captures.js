/**
 * Smoke test for captures: verifies CRUD on brainy_captures + brainy_capture_media, and RLS.
 * Run: node scripts/smoke-test-captures.js
 */
const { supabase, login } = require('../lib/supabase-client');

async function run() {
  console.log('1. Authenticating...');
  const user = await login();
  console.log(`   Logged in as ${user.email} (${user.id})`);

  console.log('2. Inserting capture...');
  const { data: capture, error: insertErr } = await supabase
    .from('brainy_captures')
    .insert({ user_id: user.id, text: 'smoke test capture' })
    .select()
    .single();
  if (insertErr) throw insertErr;
  assert(capture.text === 'smoke test capture', 'text mismatch');
  assert(capture.processed_at === null, 'should be unprocessed');
  console.log(`   Created: ${capture.id}`);

  console.log('3. Reading back...');
  const { data: fetched, error: fetchErr } = await supabase
    .from('brainy_captures')
    .select('*')
    .eq('id', capture.id)
    .single();
  if (fetchErr) throw fetchErr;
  assert(fetched.text === 'smoke test capture', 'text mismatch on read');
  assert(fetched.user_id === user.id, 'user_id mismatch');
  console.log('   Read verified.');

  console.log('4. Inserting capture_media...');
  const { data: media, error: mediaErr } = await supabase
    .from('brainy_capture_media')
    .insert({
      user_id: user.id,
      capture_id: capture.id,
      filename: 'test-photo.jpg',
      content_type: 'image/jpeg',
      storage_path: `${user.id}/captures/test-photo.jpg`,
    })
    .select()
    .single();
  if (mediaErr) throw mediaErr;
  assert(media.filename === 'test-photo.jpg', 'media filename mismatch');
  console.log(`   Media created: ${media.id}`);

  console.log('5. Marking processed...');
  const now = new Date().toISOString();
  const { data: processed, error: procErr } = await supabase
    .from('brainy_captures')
    .update({ processed_at: now })
    .eq('id', capture.id)
    .select()
    .single();
  if (procErr) throw procErr;
  assert(processed.processed_at !== null, 'should be processed');
  console.log('   Process verified.');

  console.log('6. RLS check (wrong user_id insert should fail)...');
  const fakeUserId = '00000000-0000-0000-0000-000000000000';
  const { error: rlsErr } = await supabase
    .from('brainy_captures')
    .insert({ user_id: fakeUserId, text: 'should fail' });
  assert(rlsErr !== null, 'RLS should have blocked insert with wrong user_id');
  console.log(`   RLS correctly blocked: ${rlsErr.message}`);

  console.log('7. Cascade delete (deleting capture should delete media)...');
  const { error: deleteErr } = await supabase
    .from('brainy_captures')
    .delete()
    .eq('id', capture.id);
  if (deleteErr) throw deleteErr;

  const { data: orphanMedia } = await supabase
    .from('brainy_capture_media')
    .select('id')
    .eq('id', media.id)
    .single();
  assert(orphanMedia === null, 'media should be cascade-deleted');
  console.log('   Cascade delete verified.');

  console.log('\nAll capture smoke tests passed!');
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

run().catch((err) => {
  console.error('\nCapture smoke test FAILED:', err.message);
  process.exit(1);
});

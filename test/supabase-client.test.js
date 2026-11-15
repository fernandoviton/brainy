// Every Brainy process signs in by refreshing the one token in .env. Supabase
// keeps honoring that (already-rotated) token only while its child token is
// still unused, so nothing may ever rotate the session on its own: one
// rotation revokes the .env token for every machine ("Invalid Refresh Token:
// Already Used"). supabase-js auto-rotates about an hour into any long-running
// process unless told not to.

function loadClient({ refreshSession }) {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'pk';
  process.env.SUPABASE_REFRESH_TOKEN = 'env-token';
  let createClient;
  let mod;
  jest.isolateModules(() => {
    createClient = jest.fn(() => ({ auth: { refreshSession } }));
    jest.doMock('@supabase/supabase-js', () => ({ createClient }));
    mod = require('../backend/supabase-client');
  });
  return { createClient, ...mod };
}

function session(expiresAt) {
  return { data: { user: { id: 'u1' }, session: { expires_at: expiresAt } }, error: null };
}

afterEach(() => jest.restoreAllMocks());

describe('supabase-client', () => {
  test('never auto-rotates the session (that revokes the .env refresh token)', () => {
    const { createClient } = loadClient({ refreshSession: jest.fn() });
    const options = createClient.mock.calls[0][2];
    expect(options.auth.autoRefreshToken).toBe(false);
  });

  test('login reuses the session while its access token is still valid', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000 * 1000);
    const refreshSession = jest.fn().mockResolvedValue(session(1000 + 3600));
    const { login } = loadClient({ refreshSession });
    await login();
    await login();
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  test('near expiry, login signs in again from the .env token, never the rotated one', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000 * 1000);
    const refreshSession = jest.fn().mockResolvedValue(session(1000 + 3600));
    const { login } = loadClient({ refreshSession });
    await login();
    now.mockReturnValue((1000 + 3600 - 30) * 1000);
    const user = await login();
    expect(user.id).toBe('u1');
    expect(refreshSession).toHaveBeenCalledTimes(2);
    expect(refreshSession).toHaveBeenLastCalledWith({ refresh_token: 'env-token' });
  });

  test('signs in again before supabase-js would rotate the session itself (90s before expiry)', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000 * 1000);
    const refreshSession = jest.fn().mockResolvedValue(session(1000 + 3600));
    const { login } = loadClient({ refreshSession });
    await login();
    now.mockReturnValue((1000 + 3600 - 120) * 1000);
    await login();
    expect(refreshSession).toHaveBeenCalledTimes(2);
  });

  test('a failed sign-in throws and is retried on the next call', async () => {
    const refreshSession = jest
      .fn()
      .mockResolvedValueOnce({ data: {}, error: new Error('Invalid Refresh Token: Already Used') })
      .mockResolvedValueOnce(session(Date.now() / 1000 + 3600));
    const { login } = loadClient({ refreshSession });
    await expect(login()).rejects.toThrow(/Already Used/);
    await expect(login()).resolves.toEqual({ id: 'u1' });
  });
});

/**
 * Shared mock that stubs the Supabase query builder chain.
 * Usage: jest.mock('../backend/supabase-client') then configure _mockResult / _mockError.
 */

let _mockResult = { data: [], error: null };

function setMockResult(data, error = null) {
  _mockResult = { data, error };
}

function setMockError(error) {
  _mockResult = { data: null, error };
}

function setMockSingle(data, error = null) {
  _mockResult = { data, error };
}

function buildChain() {
  const chain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    upsert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    like: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve(_mockResult)),
  };

  // Make the chain thenable so `await query` works
  chain.then = function (resolve) {
    return resolve(_mockResult);
  };

  return chain;
}

let _mockSignedUrls = { data: [], error: null };

function setMockSignedUrls(data, error = null) {
  _mockSignedUrls = { data, error };
}

const mockStorageFrom = jest.fn(() => ({
  createSignedUrls: jest.fn(() => Promise.resolve(_mockSignedUrls)),
}));

const supabase = {
  from: jest.fn(() => buildChain()),
  storage: { from: mockStorageFrom },
};

function resetMock() {
  _mockResult = { data: [], error: null };
  _mockSignedUrls = { data: [], error: null };
  supabase.from.mockImplementation(() => buildChain());
  supabase.storage.from.mockImplementation(() => ({
    createSignedUrls: jest.fn(() => Promise.resolve(_mockSignedUrls)),
  }));
}

const login = jest.fn().mockResolvedValue({ id: 'test-user-id' });

module.exports = {
  supabase,
  login,
  setMockResult,
  setMockError,
  setMockSingle,
  setMockSignedUrls,
  resetMock,
};

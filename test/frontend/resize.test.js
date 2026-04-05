const fs = require('fs');
const path = require('path');
const vm = require('vm');

const resizeCode = fs.readFileSync(path.join(__dirname, '../../frontend/resize.js'), 'utf8');

function buildMockCanvas(width, height) {
  const mockCtx = { drawImage: jest.fn() };
  const mockBlob = { size: 500, type: 'image/jpeg' };
  const canvas = {
    width: 0,
    height: 0,
    getContext: jest.fn(() => mockCtx),
    toBlob: jest.fn((cb) => cb(mockBlob)),
  };
  return { canvas, mockCtx, mockBlob };
}

function loadResize(overrides) {
  const { canvas, mockCtx, mockBlob } = buildMockCanvas();

  const mockBitmap = { width: 800, height: 600, close: jest.fn() };
  const mockCreateImageBitmap = jest.fn().mockResolvedValue(mockBitmap);

  const ctx = {
    createImageBitmap: mockCreateImageBitmap,
    document: {
      createElement: jest.fn(() => canvas),
    },
    Promise: Promise,
    ...overrides,
  };

  // Inject overrides into bitmap/canvas if provided
  if (overrides && overrides._mockBitmap) {
    mockCreateImageBitmap.mockResolvedValue(overrides._mockBitmap);
  }

  vm.createContext(ctx);
  vm.runInContext(resizeCode, ctx);

  return { ctx, canvas, mockCtx, mockBlob, mockBitmap, mockCreateImageBitmap };
}

describe('resizeImageIfNeeded', () => {
  test('returns original file unchanged for non-image files (PDF)', async () => {
    const { ctx } = loadResize();
    const file = { name: 'doc.pdf', type: 'application/pdf', size: 5000 };

    const result = await ctx.resizeImageIfNeeded(file);

    expect(result.file).toBe(file);
    expect(result.wasResized).toBe(false);
  });

  test('returns original file unchanged for small images within max dimension', async () => {
    const mockBitmap = { width: 800, height: 600, close: jest.fn() };
    const { ctx } = loadResize({ _mockBitmap: mockBitmap });
    const file = { name: 'photo.jpg', type: 'image/jpeg', size: 5000 };

    const result = await ctx.resizeImageIfNeeded(file, 1920);

    expect(result.file).toBe(file);
    expect(result.wasResized).toBe(false);
    expect(mockBitmap.close).toHaveBeenCalled();
  });

  test('resizes large landscape image and returns wasResized true', async () => {
    const mockBitmap = { width: 4032, height: 3024, close: jest.fn() };
    const { ctx, canvas, mockCtx } = loadResize({ _mockBitmap: mockBitmap });
    const file = { name: 'big.jpg', type: 'image/jpeg', size: 8000000 };

    const result = await ctx.resizeImageIfNeeded(file, 1920);

    expect(result.wasResized).toBe(true);
    expect(result.file).not.toBe(file);
    // Canvas should be sized proportionally: 1920 x 1440
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1440);
    expect(mockCtx.drawImage).toHaveBeenCalledWith(mockBitmap, 0, 0, 1920, 1440);
    expect(mockBitmap.close).toHaveBeenCalled();
  });

  test('resizes large portrait image preserving aspect ratio', async () => {
    const mockBitmap = { width: 3024, height: 4032, close: jest.fn() };
    const { ctx, canvas } = loadResize({ _mockBitmap: mockBitmap });
    const file = { name: 'portrait.jpg', type: 'image/jpeg', size: 8000000 };

    const result = await ctx.resizeImageIfNeeded(file, 1920);

    expect(result.wasResized).toBe(true);
    // Height is the longest side: scaled to 1920, width = 3024 * (1920/4032) = 1440
    expect(canvas.width).toBe(1440);
    expect(canvas.height).toBe(1920);
  });

  test('output blob has JPEG content type', async () => {
    const mockBlob = { size: 500, type: 'image/jpeg' };
    const canvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => ({ drawImage: jest.fn() })),
      toBlob: jest.fn((cb, type, quality) => {
        expect(type).toBe('image/jpeg');
        expect(quality).toBe(0.85);
        cb(mockBlob);
      }),
    };
    const mockBitmap = { width: 4000, height: 3000, close: jest.fn() };
    const { ctx } = loadResize({
      _mockBitmap: mockBitmap,
      document: { createElement: jest.fn(() => canvas) },
    });
    const file = { name: 'big.png', type: 'image/png', size: 8000000 };

    const result = await ctx.resizeImageIfNeeded(file, 1920);

    expect(result.wasResized).toBe(true);
    expect(canvas.toBlob).toHaveBeenCalled();
  });

  test('returns original file when createImageBitmap is unavailable', async () => {
    const ctx = {
      createImageBitmap: undefined,
      document: { createElement: jest.fn() },
      Promise: Promise,
    };
    vm.createContext(ctx);
    vm.runInContext(resizeCode, ctx);

    const file = { name: 'photo.jpg', type: 'image/jpeg', size: 5000 };
    const result = await ctx.resizeImageIfNeeded(file);

    expect(result.file).toBe(file);
    expect(result.wasResized).toBe(false);
  });

  test('returns original file when createImageBitmap rejects', async () => {
    const { ctx } = loadResize();
    ctx.createImageBitmap = jest.fn().mockRejectedValue(new Error('decode failed'));
    const file = { name: 'corrupt.jpg', type: 'image/jpeg', size: 5000 };

    const result = await ctx.resizeImageIfNeeded(file);

    expect(result.file).toBe(file);
    expect(result.wasResized).toBe(false);
  });

  test('uses default maxDimension of 1920 when not specified', async () => {
    const mockBitmap = { width: 4000, height: 3000, close: jest.fn() };
    const { ctx, canvas } = loadResize({ _mockBitmap: mockBitmap });
    const file = { name: 'big.jpg', type: 'image/jpeg', size: 8000000 };

    await ctx.resizeImageIfNeeded(file);

    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1440);
  });
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise(process.nextTick);

const utilsCode = fs.readFileSync(
  path.join(__dirname, '../../frontend/utils.js'),
  'utf8'
);

function makeEl(tag) {
  return { tagName: tag.toUpperCase(), href: '', target: '', className: '', textContent: '' };
}

function loadUtils() {
  const ctx = {
    window: { location: { origin: 'https://example.com', pathname: '/browse/knowledge/', hash: '' } },
    document: { createElement: jest.fn(makeEl) },
  };
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  return ctx;
}

// A placeholder span as the browse pages render it: data-storage-path, an
// optional data-content-type, and the filename as its text.
function placeholder(storagePath, filename, contentType) {
  const attrs = { 'data-storage-path': storagePath, 'data-content-type': contentType || null };
  const parent = { replaceChild: jest.fn() };
  return {
    textContent: filename,
    getAttribute: jest.fn((name) => (name in attrs ? attrs[name] : null)),
    parentNode: parent,
  };
}

function container(placeholders) {
  return { querySelectorAll: jest.fn(() => placeholders) };
}

describe('isHtmlAttachment', () => {
  test.each([
    ['deck.html', null, true],
    ['DECK.HTM', null, true],
    ['slides.Html', undefined, true],
    ['page', 'text/html', true],
    ['page', 'text/html; charset=utf-8', true],
    ['report.pdf', 'application/pdf', false],
    ['notes.html.md', null, false],
    ['', null, false],
    [null, null, false],
  ])('%s (%s) -> %s', (filename, contentType, expected) => {
    const ctx = loadUtils();
    expect(ctx.isHtmlAttachment(filename, contentType)).toBe(expected);
  });
});

describe('attachmentViewerHref', () => {
  test('points at the sibling viewer page with the path and name in the hash', () => {
    const ctx = loadUtils();
    const href = ctx.attachmentViewerHref('u1/knowledge/games/deck.html', 'deck.html');
    expect(href).toBe('../viewer/#path=u1%2Fknowledge%2Fgames%2Fdeck.html&name=deck.html');
  });

  test('encodes characters that would break the hash', () => {
    const ctx = loadUtils();
    const href = ctx.attachmentViewerHref('a/b&c=d.html', 'b&c=d #1.html');
    expect(href).toBe('../viewer/#path=a%2Fb%26c%3Dd.html&name=b%26c%3Dd%20%231.html');
  });
});

describe('resolveAttachmentLinks', () => {
  test('replaces a non-HTML placeholder with a link to its signed URL', async () => {
    const ctx = loadUtils();
    const ph = placeholder('u1/files/report.pdf', 'report.pdf', 'application/pdf');
    const bucket = { createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed/report.pdf' } }) };

    ctx.resolveAttachmentLinks(container([ph]), bucket);
    await flushPromises();

    expect(bucket.createSignedUrl).toHaveBeenCalledWith('u1/files/report.pdf', 3600);
    const a = ph.parentNode.replaceChild.mock.calls[0][0];
    expect(a.href).toBe('https://signed/report.pdf');
    expect(a.target).toBe('_blank');
    expect(a.textContent).toBe('report.pdf');
    expect(a.className).toBe('collateral-file-link');
  });

  test('routes an .html placeholder to the sandboxed viewer, without a signed URL', () => {
    const ctx = loadUtils();
    const ph = placeholder('u1/k/deck.html', 'deck.html');
    const bucket = { createSignedUrl: jest.fn() };

    ctx.resolveAttachmentLinks(container([ph]), bucket);

    expect(bucket.createSignedUrl).not.toHaveBeenCalled();
    const a = ph.parentNode.replaceChild.mock.calls[0][0];
    expect(a.href).toBe('../viewer/#path=u1%2Fk%2Fdeck.html&name=deck.html');
    expect(a.target).toBe('_blank');
    expect(a.textContent).toBe('deck.html');
  });

  test('routes a text/html placeholder with no extension to the viewer', () => {
    const ctx = loadUtils();
    const ph = placeholder('u1/k/page', 'page', 'text/html');
    const bucket = { createSignedUrl: jest.fn() };

    ctx.resolveAttachmentLinks(container([ph]), bucket);

    expect(bucket.createSignedUrl).not.toHaveBeenCalled();
    expect(ph.parentNode.replaceChild.mock.calls[0][0].href).toContain('../viewer/#path=');
  });

  test('leaves the placeholder alone when no signed URL comes back', async () => {
    const ctx = loadUtils();
    const ph = placeholder('u1/files/gone.pdf', 'gone.pdf');
    const bucket = { createSignedUrl: jest.fn().mockResolvedValue({ data: null }) };

    ctx.resolveAttachmentLinks(container([ph]), bucket);
    await flushPromises();

    expect(ph.parentNode.replaceChild).not.toHaveBeenCalled();
  });
});

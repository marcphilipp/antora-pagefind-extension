'use strict'

const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const { test } = require('node:test')
const { register } = require('..')

const page = (component, version, attributes, body = '<article class="doc"><h1>Hello</h1><p>searchable text</p></article>') => ({
  src: { component, version },
  out: { path: `${component}/index.html` },
  pub: { url: `/${component}/index.html` },
  asciidoc: { attributes },
  contents: Buffer.from(`<html lang="en"><body><nav>skip me</nav>${body}</body></html>`),
})

const publish = async (pages) => {
  const handlers = {}
  register.call({ getLogger: () => ({ info: () => {} }), on: (name, fn) => (handlers[name] = fn) })
  const files = []
  await handlers.beforePublish({
    playbook: { env: {} },
    contentCatalog: {
      getPages: (filter) => pages.filter(filter),
      getComponent: (name) => ({ title: name }),
      getComponentVersion: (_, version) => ({ displayVersion: version }),
    },
    siteCatalog: { addFile: (file) => files.push(file) },
  })
  return files
}

const inDir = (files, dir) => files.filter((it) => it.out.path.startsWith(`pagefind/${dir}/`))
const filterFiles = async (pages) => inDir(await publish(pages), 'filter').length
const fragments = (files) =>
  inDir(files, 'fragment').map((it) => JSON.parse(zlib.gunzipSync(it.contents).toString().replace(/^pagefind_dcd/, '')))
const titles = async (pages) => fragments(await publish(pages)).map((it) => it.meta.title).sort()

test('appends the filter values that vary to the page titles', async () => {
  const titled = (component, version, doctitle) => {
    const it = page(component, version)
    it.asciidoc.doctitle = doctitle
    return it
  }
  assert.deepEqual(await titles([titled('core', '1.0', 'Using <code>a &amp; "b"</code>'), titled('db', '2.0', 'Intro')]), [
    'Intro — db 2.0',
    'Using a & "b" — core 1.0',
  ])
  assert.deepEqual(await titles([titled('core', '1.0', 'One'), titled('db', '1.0', 'Two')]), ['One — core', 'Two — db'])
  // nothing varies, or the page has no doctitle: Pagefind derives the title from the heading
  assert.deepEqual(await titles([titled('core', '1.0', 'One')]), ['Hello'])
  assert.deepEqual(await titles([page('core', '1.0'), titled('db', '2.0', 'Two')]), ['Hello', 'Two — db 2.0'])
})

test('omits filters that have a single value', async () => {
  assert.equal(await filterFiles([page('core', ''), page('core', '')]), 0)
  assert.equal(await filterFiles([page('core', '1.0'), page('core', '2.0')]), 1)
  assert.equal(await filterFiles([page('core', '1.0'), page('db', '1.0')]), 1)
  assert.equal(await filterFiles([page('core', '1.0'), page('db', '2.0')]), 2)
})

test('registers the search UI and publishes a Pagefind bundle', async () => {
  const handlers = {}
  const logged = []
  register.call({
    getLogger: () => ({ info: (...args) => logged.push(args) }),
    on: (name, fn) => (handlers[name] = fn),
  })

  const playbook = { env: {} }
  const uiFiles = []
  handlers.uiLoaded({ playbook, uiCatalog: { findByType: () => [], addFile: (file) => uiFiles.push(file) } })
  assert.equal(playbook.env.SITE_SEARCH_PROVIDER, 'pagefind')
  assert.deepEqual(uiFiles.map((it) => [it.type, it.path, it.stem]), [['partial', 'partials/search-scripts.hbs', 'search-scripts']])
  assert.match(uiFiles[0].contents.toString(), /pagefind-modal/)

  const pages = [
    page('core', '1.0', {}),
    page('home', '2.0', {}),
    page('hidden', '1.0', { noindex: '' }),
    page('bare', '1.0', {}, '<p>no main content</p>'),
  ]
  const siteFiles = []
  await handlers.beforePublish({
    playbook,
    contentCatalog: {
      getPages: (filter) => pages.filter(filter),
      getComponent: (name) => ({ title: `The "${name}" & co` }),
      getComponentVersion: (_, version) => ({ displayVersion: version }),
    },
    siteCatalog: { addFile: (file) => siteFiles.push(file) },
  })

  assert.equal(playbook.env.SITE_SEARCH_PROVIDER, undefined)
  assert.deepEqual(logged, [['Indexed %d pages', 2]])
  const paths = siteFiles.map((it) => it.out.path)
  for (const expected of ['pagefind/pagefind.js', 'pagefind/pagefind-component-ui.js', 'pagefind/pagefind-component-ui.css']) {
    assert.ok(paths.includes(expected), `missing ${expected}`)
  }
  assert.equal(paths.filter((it) => it.startsWith('pagefind/fragment/')).length, 2)
  // one filter file per filter name: Component and Version
  assert.equal(paths.filter((it) => it.startsWith('pagefind/filter/')).length, 2)
  assert.ok(siteFiles.every((it) => Buffer.isBuffer(it.contents) && it.pub.url === `/${it.out.path}`))

  const indexed = fragments(siteFiles).sort((a, b) => a.url.localeCompare(b.url))
  assert.deepEqual(indexed.map((it) => it.filters), [
    { Component: ['The "core" & co'], Version: ['1.0'] },
    { Component: ['The "home" & co'], Version: ['2.0'] },
  ])
  for (const { content } of indexed) {
    assert.match(content, /searchable text/)
    assert.doesNotMatch(content, /skip me/)
  }

  // the partial relies on these parts of the Component UI, __search__ being private: fail on upgrades that drop them
  const ui = siteFiles.find((it) => it.out.path === 'pagefind/pagefind-component-ui.js').contents.toString()
  const partial = uiFiles[0].contents.toString()
  const elements = [...new Set(partial.match(/(?<=<)pagefind-[a-z-]+/g))]
  assert.equal(elements.length, 11)
  const attributes = partial.match(/(?<= )(excerpt-length|max-sub-results)(?==)/g)
  assert.equal(attributes.length, 2)
  for (const used of [...elements, ...attributes].map((it) => `"${it}"`).concat('PagefindComponents', 'getInstanceManager', '__search__(', 'triggerFilters(')) {
    assert.ok(ui.includes(used), `Component UI lacks ${used}`)
  }
})

test('keeps the search-scripts partial of the UI', () => {
  const handlers = {}
  register.call({ getLogger: () => ({}), on: (name, fn) => (handlers[name] = fn) })
  const uiCatalog = {
    findByType: () => [{ path: 'partials/search-scripts.hbs' }],
    addFile: () => assert.fail('must not replace the partial'),
  }
  handlers.uiLoaded({ playbook: { env: {} }, uiCatalog })
})

test('passes the UI options to the partial', () => {
  const run = (config) => {
    const handlers = {}
    register.call({ getLogger: () => ({}), on: (name, fn) => (handlers[name] = fn) }, { config })
    const playbook = { env: {} }
    handlers.uiLoaded({ playbook, uiCatalog: { findByType: () => [], addFile: () => {} } })
    return playbook.env
  }
  assert.deepEqual(run({}), { SITE_SEARCH_PROVIDER: 'pagefind' })
  assert.deepEqual(run({ excerptLength: 60, maxSubResults: 5 }), {
    SITE_SEARCH_PROVIDER: 'pagefind',
    SITE_SEARCH_EXCERPT_LENGTH: 60,
    SITE_SEARCH_MAX_SUB_RESULTS: 5,
  })
  for (const invalid of [0, -1, 1.5, '60"', true]) {
    assert.throws(() => run({ excerptLength: invalid }), /excerptLength must be a positive integer/)
    assert.throws(() => run({ maxSubResults: invalid }), /maxSubResults must be a positive integer/)
  }
})

'use strict'

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { register } = require('..')

const page = (component, version, attributes, body = '<article class="doc"><h1>Hello</h1><p>searchable text</p></article>') => ({
  src: { component, version },
  out: { path: `${component}/index.html` },
  pub: { url: `/${component}/index.html` },
  asciidoc: { attributes },
  contents: Buffer.from(`<html lang="en"><body><nav>skip me</nav>${body}</body></html>`),
})

const filterFiles = async (pages) => {
  const handlers = {}
  register.call({ getLogger: () => ({ info: () => {} }), on: (name, fn) => (handlers[name] = fn) })
  const paths = []
  await handlers.beforePublish({
    playbook: { env: {} },
    contentCatalog: {
      getPages: (filter) => pages.filter(filter),
      getComponent: (name) => ({ title: name }),
      getComponentVersion: (_, version) => ({ displayVersion: version }),
    },
    siteCatalog: { addFile: (file) => paths.push(file.out.path) },
  })
  return paths.filter((it) => it.startsWith('pagefind/filter/')).length
}

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

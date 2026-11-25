'use strict'

const fs = require('node:fs')
const ospath = require('node:path')

const PARTIAL_PATH = 'partials/search-scripts.hbs'
// the main content element of the Antora default UI and UIs derived from it
const ARTICLE_RX = /<article\b[^>]*\bclass="[^"]*\bdoc\b[^"]*"[^>]*>/

module.exports.register = function () {
  const logger = this.getLogger('antora-pagefind-extension')

  // same contract as @antora/lunr-extension: the UI renders its search box if a provider is set
  this.on('uiLoaded', ({ playbook, uiCatalog }) => {
    playbook.env.SITE_SEARCH_PROVIDER = 'pagefind'
    if (uiCatalog.findByType('partial').some(({ path }) => path === PARTIAL_PATH)) return
    uiCatalog.addFile({
      contents: fs.readFileSync(ospath.join(__dirname, '../data', PARTIAL_PATH)),
      path: PARTIAL_PATH,
      stem: 'search-scripts',
      type: 'partial',
    })
  })

  this.on('beforePublish', async ({ playbook, contentCatalog, siteCatalog }) => {
    delete playbook.env.SITE_SEARCH_PROVIDER
    const pagefind = await import('pagefind') // ESM-only
    try {
      const { index } = check(await pagefind.createIndex())
      const pages = contentCatalog.getPages((it) => it.out && it.asciidoc?.attributes?.noindex == null)
      const filtersByPage = new Map(pages.map((page) => [page, filtersOf(page, contentCatalog)]))
      const values = {}
      for (const filters of filtersByPage.values()) {
        for (const [name, value] of Object.entries(filters)) (values[name] ??= new Set()).add(value)
      }
      let count = 0
      for (const [page, filters] of filtersByPage) {
        // a filter with a single value cannot narrow the results, so it would only clutter the UI
        const content = tagContent(page, Object.entries(filters).filter(([name]) => values[name].size > 1))
        if (!content) continue
        check(await index.addHTMLFile({ url: page.pub.url, content }))
        count++
      }
      const { files } = check(await index.getFiles())
      for (const { path, content } of files) {
        siteCatalog.addFile({
          contents: Buffer.from(content),
          out: { path: `pagefind/${path}` },
          pub: { url: `/pagefind/${path}` },
        })
      }
      logger.info('Indexed %d pages', count)
    } finally {
      await pagefind.close()
    }
  })
}

function filtersOf ({ src: { component, version } }, contentCatalog) {
  const filters = { Component: contentCatalog.getComponent(component)?.title || component }
  // an unversioned component has nothing to filter by
  if (version) filters.Version = contentCatalog.getComponentVersion(component, version)?.displayVersion || version
  return filters
}

/**
 * Restricts indexing to the main content of the page, tags it with the given filters, and appends
 * their values to the title of the page so that search results show where a page belongs.
 * Returns undefined if the page has no main content.
 */
function tagContent (page, filters) {
  let markers = filters
    .map(([name, value]) => `<span data-pagefind-filter="${name}[data-value]" data-value="${escapeAttr(value)}"></span>`)
    .join('')
  const doctitle = page.asciidoc?.doctitle
  if (doctitle && filters.length) {
    // the doctitle is HTML, so it is already escaped apart from quotes once its tags are removed
    const title = doctitle.replace(/<[^>]*>/g, '').replace(/"/g, '&quot;')
    const suffix = escapeAttr(filters.map(([, value]) => value).join(' '))
    markers += `<span data-pagefind-meta="title[data-value]" data-value="${title} — ${suffix}"></span>`
  }
  let found
  const html = page.contents.toString().replace(ARTICLE_RX, (tag) => {
    found = true
    return `${tag.slice(0, -1)} data-pagefind-body>${markers}`
  })
  return found ? html : undefined
}

function escapeAttr (value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function check (result) {
  if (result.errors.length) throw new Error(`Pagefind failed: ${result.errors.join('; ')}`)
  return result
}

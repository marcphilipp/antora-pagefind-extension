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
      let count = 0
      for (const page of contentCatalog.getPages((it) => it.out && it.asciidoc?.attributes?.noindex == null)) {
        const content = tagContent(page, contentCatalog)
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

/**
 * Restricts indexing to the main content of the page and tags it with the component and version
 * so that search results can be filtered by them. Returns undefined if the page has no main content.
 */
function tagContent (page, contentCatalog) {
  const { component, version } = page.src
  const filters = { Component: contentCatalog.getComponent(component)?.title || component }
  // an unversioned component has nothing to filter by
  if (version) filters.Version = contentCatalog.getComponentVersion(component, version)?.displayVersion || version
  const markers = Object.entries(filters)
    .map(([name, value]) => `<span data-pagefind-filter="${name}[data-value]" data-value="${escapeAttr(value)}"></span>`)
    .join('')
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

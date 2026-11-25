# Antora Pagefind Extension

Adds [Pagefind](https://pagefind.app) search to an [Antora](https://antora.org) site as a drop-in replacement for `@antora/lunr-extension`.

## Usage

Install it into your playbook project, pinned to a commit:

```console
$ npm i github:<owner>/antora-pagefind-extension#<commit-sha>
```

Register it in your playbook:

```yaml
antora:
  extensions:
    - antora-pagefind-extension
```

## Excluding pages

As with the Lunr extension, a page that sets the `noindex` attribute in its AsciiDoc header is not indexed.
To exclude a whole component version, set the attribute in its `antora.yml`:

```yaml
asciidoc:
  attributes:
    noindex: '@'
```

## What it does

- Indexes the main content (`<article class="doc">`) of every published page, except pages that set the `noindex` attribute, and publishes the Pagefind bundle to `/pagefind/`.
- Tags every page with its component title and version so that results can be filtered by them. A filter that would have a single value for the whole site is omitted.
- Replaces the search box of the UI (`#search-field`) with the search modal of Pagefind's Component UI. Results link to the matching sections of a page.

To use a different search UI, add a `partials/search-scripts.hbs` file to your UI bundle or supplemental UI; the extension then leaves it alone.

## Requirements

- Antora 3
- A UI that follows the conventions of the Antora default UI: it renders an element with the ID `search-field` and includes the `search-scripts` partial if `env.SITE_SEARCH_PROVIDER` is set.
- The site must be served via HTTP; search does not work from `file://` URLs.

## Development

```console
$ npm install
$ npm test
```

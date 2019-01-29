/* globals beaker window */

import yo from 'yo-yo'
import moment from 'moment'
import renderUserResult from '../com/search/user-result'
import renderPostResult from '../com/search/post-result'
import renderSiteResult from '../com/search/site-result'
import {renderSourceBanner, renderSourceSubnav} from '../com/search/source-view'
import {polyfillHistoryEvents, pushUrl} from '../../lib/fg/event-handlers'
import * as toast from '../com/toast'

const LIMIT = 20

function C(id, label, datasets, siteTypes) {
  if (siteTypes) siteTypes = siteTypes.map(t => `unwalled.garden${t}`)
  return {id, label, datasets, siteTypes}
}
const CATEGORIES = [
  C('all', 'All', ['followgraph', 'link_posts', 'published_sites']),
  C('users', 'Users', ['followgraph']),
  C('articles', 'Articles', ['link_posts', 'published_sites'], ['/media/article', '/channel/blog']),
  C('photos', 'Photos', ['link_posts', 'published_sites'], ['/channel/photo', '/media/photo-album', '/media/photo']),
  C('video', 'Videos', ['link_posts', 'published_sites'], ['/channel/video', '/media/video-playlist', '/media/video']),
  C('music', 'Music', ['link_posts', 'published_sites'], ['/channel/music', '/media/music-playlist', '/media/music-album', '/media/song']),
  C('podcasts', 'Podcasts', ['link_posts', 'published_sites'], ['/channel/podcast', '/media/podcast-episode']),
  C('files', 'Files', ['link_posts', 'published_sites'], ['/media/file-set', '/media/file']),
  C('templates', 'Templates', ['link_posts', 'published_sites'], ['/template'])
]

// globals
//

var currentUserSession = null
var sourceInfo = null
var results = []
var highlightNonce
var hasMore
var newPostValues = {
  title: '',
  description: '',
  url: ''
}
var newPostErrors = {
  title: undefined,
  description: undefined,
  url: undefined
}

// main
// =

setup()
async function setup () {
  polyfillHistoryEvents()
  window.addEventListener('pushstate', readStateFromURL)
  window.addEventListener('popstate', readStateFromURL)

  currentUserSession = await beaker.browser.getUserSession()
  readStateFromURL()
}

async function readStateFromURL () {
  var view = getView()
  var source = getParam('source')
  
  try {
    if (view === 'new-post') {
      results = []
      sourceInfo = null
    } else {
      if (source && (!sourceInfo || sourceInfo.url !== source)) {
        // get source info
        let archive = new DatArchive(source)
        sourceInfo = await archive.getInfo()
        if (source !== sourceInfo.url) {
          // adjust source param if not exactly ==
          setParams({source: sourceInfo.url})
          return
        }
      } else if (!source && sourceInfo) {
        // clear out
        sourceInfo = null
      }

      // run query
      console.log('running query', getParam('q'))
      var category = CATEGORIES.find(c => c.id === getCategory()) || CATEGORIES[0]
      let page = getPage()
      let res = await beaker.crawler.listSearchResults({
        user: currentUserSession.url, 
        query: getParam('q'),
        datasets: category.datasets,
        siteTypes: category.siteTypes,
        source,
        hops: getHops(),
        since: getSinceTS(),
        offset: (page - 1) * LIMIT,
        limit: LIMIT + 1 // get 1 more than needed to detect if more results exist
      })
      results = res.results
      highlightNonce = res.highlightNonce

      // detect hasMore
      hasMore = results.length > LIMIT
      if (hasMore) results.pop() // discard extra
      console.log('results', results)
    }
  } catch (err) {
    console.error(err)
    toast.create(err.toString(), 'error', 5e3)
  }

  update()
}

function getParam (k) {
  return (new URL(window.location)).searchParams.get(k)
}

function setParams (kv) {
  var url = (new URL(window.location))

  // on view-changes, clear existing params
  if ('view' in kv && kv.view !== getView()) {
    url.search = ''
  }

  for (var k in kv) {
    url.searchParams.set(k, kv[k])
  }
  window.history.pushState({}, null, url)
}

function deleteParam (k) {
  var url = (new URL(window.location))
  url.searchParams.delete(k)
  window.history.pushState({}, null, url)
}

function getView () {
  return getParam('view')
}

function getCategory () {
  var cat = getParam('category')
  if (!cat) cat = 'all'
  return cat
}

function getSourceView () {
  return getParam('sourceView') || 'profile'
}

function getPage () {
  return +(getParam('page') || 1)
}

function getHops () {
  return +(getParam('hops') || 2)
}

function getSinceTS () {
  var since = getParam('since')
  if (!since || since === 'all') return undefined
  return moment().subtract(1, since).valueOf()
}

function filterTabByView (category) {
  if (getParam('source')) {
    // dont show users tab when viewing a user
    if (category.id === 'users') return false
  }
  return true
}

// rendering
// =

function update () {
  const view = getView()
  const query = getParam('q') || ''
  const category = getCategory()
  const sourceView = getSourceView()

  const renderTab = ({id, label}) => yo`<div class="tab ${category === id ? 'active' : ''}" onclick=${() => onClickTab(id)}>${label}</div>`

  yo.update(document.querySelector('.search-wrapper'), yo`
    <div class="search-wrapper builtin-wrapper">
      <div class="builtin-main">
        ${sourceInfo
          ? [
            yo`<a href="/" onclick=${pushUrl}><i class="fas fa-angle-double-left"></i> Back</a>`,
            renderSourceBanner({sourceInfo, currentUserSession}),
            renderSourceSubnav({sourceView, onChangeSourceView})
          ] : yo`
            <div class="search-header">
              ${renderSearchControl()}
            </div>`
        }

        ${query
          ? yo`
            <div class="showing-results-for">
              Showing results for "${query}". <a class="link" onclick=${onClearQuery}>Clear query.</a>
            </div>`
          : ''}

        <div class="search-body">
          <div class="tabs">
            ${CATEGORIES.filter(filterTabByView).map(renderTab)}
          </div>
          ${view === 'new-post'
            ? renderNewPostColumn()
            : renderSearchResultsColumn({query})}
          <div class="search-controls-col">
            ${renderSideControls()}
          </div>
        </div>
      </div>
    </div>`
  )
}

function renderSearchResultsColumn ({query}) {
  const page = getPage()
  const isEmpty = !results || results.length === 0

  return yo`
    <div class="search-results-col">
      <div class="search-results">
        ${isEmpty
          ? yo`
            <div class="empty">
              No results${query ? ` for "${query}"` : ''}.
              <a class="link" href="https://duckduckgo.com${query ? ('?q=' + encodeURIComponent(query)) : ''}">Try your search on DuckDuckGo <span class="fa fa-angle-double-right"></span></a>
            </div>`
          : ''}
        ${results.map(result => {
          if (result.resultType === 'user') return renderUserResult(result, currentUserSession, highlightNonce)
          if (result.resultType === 'post') return renderPostResult(result, currentUserSession, highlightNonce)
          return renderSiteResult(result, currentUserSession, highlightNonce)
        })}
      </div>
      <div class="pagination">
        <a class="btn ${page > 1 ? '' : 'disabled'}" onclick=${onClickPrevPage}><span class="fa fa-angle-left"></span></a>
        <span class="current">${page}</span>
        <a class="btn ${hasMore ? '' : 'disabled'}" onclick=${onClickNextPage}>Next page <span class="fa fa-angle-right"></span></a>
      </div>
      ${query
        ? yo`
          <div class="alternative-engines">
            <ul>
              <li>Try other search engines:</li>
              <li><a class="link" href="https://duckduckgo.com${query ? '?q=' + encodeURIComponent(query) : ''}" target="_blank"><span class="fas fa-search"></span> DuckDuckGo</a></li>
              <li><a class="link" href="https://google.com/search${query ? '?q=' + encodeURIComponent(query) : ''}" target="_blank"><span class="fab fa-google"></span> Google</a></li>
              <li><a class="link" href="https://twitter.com/search${query ? '?q=' + encodeURIComponent(query) : ''}" target="_blank"><span class="fab fa-twitter"></span> Twitter</a></li>
              <li><a class="link" href="https://reddit.com/search${query ? '?q=' + encodeURIComponent(query) : ''}" target="_blank"><span class="fab fa-reddit-alien"></span> Reddit</a></li>
              <li><a class="link" href="https://github.com/search${query ? '?q=' + encodeURIComponent(query) : ''}" target="_blank"><span class="fab fa-github-alt"></span> GitHub</a></li>
            </ul>
          </div>`
        : ''}
    </div>`
}

function renderNewPostColumn () {
  var preview = {
    author: {
      url: currentUserSession.url,
      title: currentUserSession.title,
      thumbUrl: `${currentUserSession.url}/thumb`
    },
    content: newPostValues,
    crawledAt: Date.now(),
    createdAt: Date.now()
  }

  const input = (key, placeholder) => yo`
    <div class="input ${newPostErrors[key] ? 'has-error' : ''}">
      <input name=${key} placeholder=${placeholder} value=${newPostValues[key]} onkeyup=${e => onKeyupNewPostInput(e, key)}>
      ${newPostErrors[key] ? yo`<div class="error">${newPostErrors[key]}</div>` : ''}
    </div>`

  return yo`
    <div class="new-post-col">
      <form onsubmit=${onSubmitPost}>
        <h2>Post a link</h2>
        ${input('url', 'URL')}
        ${input('title', 'Title')}
        ${input('description', 'Description (optional)')}
        <div class="form-actions">
          <button class="btn primary thick">Publish</button>
          <button class="btn transparent thick" onclick=${onClickNewPostCancel}>Cancel</button>
        </div>
      </form>
      <div><small>Preview:</small></div>
      <div class="search-results">
        ${renderPostResult(preview, currentUserSession, 0)}
      </div>
    </div>`
}

function renderSearchControl () {
  var query = getParam('q') || ''
  return yo`
    <div class="search-container">
      <input autofocus onkeyup=${onUpdateSearchQuery} placeholder="Search your Web" class="search" value=${query} />
      <i class="fa fa-search"></i>
      ${query
        ? yo`
          <span onclick=${onClearQuery} class="clear-btn">
            ${renderTimes()} clear query
          </span>`
        : ''}
    </div>`
}

function renderSideControls () {
  const hops = getHops()
  const since = getParam('since') || 'all'
  var ctrls = []

  if (sourceInfo) {
    // source-specific controls
    ctrls.push(yo`
      <div class="search-sidecontrol">
        <h3>Filters</h3>
        ${renderRadio({
          onclick ({id}) {
            setParams({source: getParam('source'), since: id})
          },
          current: since,
          items: [
            {id: 'all', label: 'All time'},
            {id: 'day', label: 'Past day'},
            {id: 'week', label: 'Past week'},
            {id: 'month', label: 'Past month'},
            {id: 'year', label: 'Past year'}
          ]
        })}
      </div>`
    )
  } else {
    // general controls
    ctrls.push(yo`
      <button class="btn primary thick full-width" onclick=${onClickCreatePost}>
        Create a post
      </button>`
    )

    ctrls.push(yo`
      <div class="search-sidecontrol">
        <h3>Filters</h3>
        ${renderRadio({
          onclick ({id}) {
            setParams({view: '', hops: id})
          },
          current: hops,
          items: [
            {id: 2, label: 'All of your network'},
            {id: 1, label: 'Followed users'}
          ]
        })}
      </div>`
    )

    ctrls.push(yo`
      <div class="search-sidecontrol">
        ${renderRadio({
          onclick ({id}) {
            setParams({view: '', since: id})
          },
          current: since,
          items: [
            {id: 'all', label: 'All time'},
            {id: 'day', label: 'Past day'},
            {id: 'week', label: 'Past week'},
            {id: 'month', label: 'Past month'},
            {id: 'year', label: 'Past year'}
          ]
        })}
      </div>`
    )
  }

  return ctrls
}

function renderRadio ({onclick, current, items}) {
  const renderItem = item => yo`<li class=${item.id === current ? 'active' : ''} onclick=${() => onclick(item)}><span class="fas fa-check"></span> ${item.label}</li>`
  return yo`<ul class="radio">${items.map(renderItem)}</ul>`
}

function renderTimes () {
  var el = yo`<span></span>`
  el.innerHTML = '&times;'
  return el
}

// event handlers
// =

function onClickCreatePost (e) {
  setParams({view: 'new-post'})
}

function onChangeSourceView (sourceView) {
  setParams({sourceView})
}

function onKeyupNewPostInput (e, key) {
  var el = e.currentTarget
  setTimeout(() => {
    newPostValues[key] = el.value
    update()
  }, 0)
}

async function onSubmitPost (e) {
  e.preventDefault()

  // validate
  for (let k in newPostValues) {
    newPostValues[k] = newPostValues[k].trim() // massage
    newPostErrors[k] = undefined // reset errors
  }
  if (!newPostValues.title) {
    newPostErrors.title = 'Title is required'
  }
  if (!newPostValues.url) {
    newPostErrors.url = 'URL is required'
  } else {
    try { new URL(newPostValues.url) }
    catch (err) { newPostErrors.url = 'Must be a valid URL' }
  }

  update()
  var hasError = Object.values(newPostErrors).find(v => !!v)
  if (hasError) return

  try {
    // create
    await beaker.linkFeed.create(newPostValues)
    toast.create('Posted')
  } catch (err) {
    console.error(err)
    toast.create(err.toString(), 'error', 5e3)
  }

  // reset
  for (let k in newPostValues) {
    newPostValues[k] = ''
  }
  setParams({view: ''})
}

function onClickNewPostCancel (e) {
  e.preventDefault()

  // confirm
  var hasValues = Object.values(newPostValues).find(v => !!v)
  if (hasValues && !confirm('Are you sure?')) return

  // reset
  for (let k in newPostValues) {
    newPostValues[k] = ''
  }
  setParams({view: ''})
}

function onClickPrevPage (e) {
  var page = (getPage())
  if (page <= 1) return
  setParams({page: page - 1})
}

function onClickNextPage (e) {
  if (!hasMore) return
  setParams({page: (getPage()) + 1})
}

function onUpdateSearchQuery (e) {
  if (e.key === 'Enter') {
    setParams({
      view: '',
      q: e.target.value.toLowerCase(),
      category: getCategory()
    })
  }
}

function onClickTab (category) {
  var params = {category}
  var view = getView()
  if (view === 'new-post') params.view = '' // reset view if it's set
  var source = getParam('source')
  if (source) params.source = source // preserve source
  setParams(params)
}

function onClearQuery () {
  deleteParam('q')
}

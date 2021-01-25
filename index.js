const { URL, URLSearchParams } = require('url')
const createError = require('http-errors')

const JsonApiQueryParserClass = require('jsonapi-query-parser')
const jsonapiQueryParser = new JsonApiQueryParserClass()

const defaults = {
  response: {
    jsonapi: { version: '1.0' }
  },
  pagination: 'offset-based',
  logger: console.error
}

const querySerialize = function (obj) {
  const str = []
  Object.keys(obj).forEach(p => {
    str.push(encodeURIComponent(p) + '=' + encodeURIComponent(obj[p]))
  })
  return str.join('&')
}

// Docs
// Includes middy/middleware/httpErrorHandler handling
// Doesn't included filter parsing

const request = (handler) => {
  // parse
  if (handler.event.queryStringParameters) {
    handler.event.queryStringParametersRaw = handler.event.queryStringParameters // Used for `links` in response
    const { include, fields, sort, page } = jsonapiQueryParser.parseRequest(
      '?' + querySerialize(handler.event.queryStringParameters)
    ).queryData
    const params = { include, fields, sort, page }

    const disallowed = ['include', 'fields', 'sort', 'page']
    Object.keys(handler.event.queryStringParameters)
      .filter(key => !disallowed.includes(key.split('[')[0]))
      .forEach(key => {
        params[key] = handler.event.queryStringParameters[key]
      })

    handler.event.queryStringParameters = params
  }

  return
}

const httpError = handler => {
  if (
    !(handler.error instanceof createError.HttpError) ||
    Array.isArray(handler.error.details)
  ) {
    return {}
  }

  handler.response.statusCode = handler.error.statusCode
  handler.response.body = Object.assign({}, handler.response.body, {
    errors: [
      {
        status: handler.error.statusCode.toString(),
        title: handler.error.name,
        detail: handler.error.message
      }
    ]
  })
  return handler.response
}

const jsonschemaErrors = handler => {
  if (
    !(handler.error instanceof createError.BadRequest) ||
    !Array.isArray(handler.error.details)
  ) {
    return {}
  }
  handler.response.statusCode = handler.error.statusCode
  handler.response.body = Object.assign({}, handler.response.body, {
    errors: handler.error.details.map(error => ({
      detail: error.message,
      source: {
        pointer: error.schemaPath.substr(1),
        parameter: error.dataPath.substr(1)
      },
      meta: error.params
    }))
  })
  return handler.response
}

const unhandledError = handler => {
  handler.response.statusCode = 500
  handler.response.body = Object.assign({}, handler.response.body, {
    errors: [
      {
        status: '500',
        title: 'Internal Server Error',
        detail: 'Please contact admin and provide `X-Request-ID` value.'
      }
    ]
  })
  return handler.response
}

const linkUrl = handler => {
  const params = new URLSearchParams(handler.event.queryStringParametersRaw)
  const url = new URL(
    `${handler.event.path}?${params.toString()}`,
    `https://${handler.event.headers['Host']}` // Note: https assumed
  )
  const urlPrefix = `${
    url.host.substr(0, 9) !== 'localhost' // workaround for serverless-offline
      ? url.protocol
      : 'http'
  }//${url.host}${url.pathname}`

  return { urlPrefix, url }
}

const pageBasedPagination = handler => {
  // page[number], page[size]
  const body = handler.response.body
  if (
    !body.meta ||
    !body.meta.item ||
    typeof body.meta.item.count !== 'number' ||
    typeof body.meta.item.total !== 'number'
  ) {
    return body
  }

  const { count, total } = body.meta.item
  if (count > total) {
    console.error(handler.context.awsRequestId, 'Row count > total rows.')
    return body
  }

  const { urlPrefix, url } = linkUrl(handler)

  const limit =
    handler.event.queryStringParameters &&
    Number.parseInt(handler.event.queryStringParameters.page.size, 10) >= 1
      ? Number.parseInt(handler.event.queryStringParameters.page.size, 10)
      : total

  const pages = Math.ceil(total / limit)
  const page = Number.parseInt(
    handler.event.queryStringParameters.page.number,
    10
  )

  if (pages === 1) return body

  body.meta.page = {}
  body.meta.page.first = 1
  body.meta.page.prev = page > 1 ? page + 1 : null
  body.meta.page.self = page
  body.meta.page.next = page < pages ? page + 1 : null
  body.meta.page.last = pages

  body.links = {}
  body.links.self = urlPrefix + url.search

  url.searchParams.set('page[number]', body.meta.page.first)
  body.links.first = urlPrefix + url.search

  url.searchParams.set('page[number]', body.meta.page.last)
  body.links.last = urlPrefix + url.search

  if (page > 1) {
    url.searchParams.set('page[number]', body.meta.page.prev)
    body.links.prev = urlPrefix + url.search
  }

  if (page < pages) {
    url.searchParams.set('page[number]', body.meta.page.next)
    body.links.next = urlPrefix + url.search
  }

  return handler.response.body
}

const offsetBasedPagination = handler => {
  // page[limit], page[offset]
  const body = handler.response.body
  if (
    !body.meta ||
    !body.meta.item ||
    typeof body.meta.item.count !== 'number' ||
    typeof body.meta.item.total !== 'number'
  ) {
    return body
  }

  const { count, total } = body.meta.item
  if (count > total) {
    console.error(handler.context.awsRequestId, 'Row count > total rows.')
    return body
  }

  const { urlPrefix, url } = linkUrl(handler)

  const limit =
    handler.event.queryStringParameters &&
    Number.parseInt(handler.event.queryStringParameters.page.limit, 10) >= 1
      ? Number.parseInt(handler.event.queryStringParameters.page.limit, 10)
      : 1 // 1 to prevent division by zero
  const offset =
    handler.event.queryStringParameters &&
    Number.parseInt(handler.event.queryStringParameters.page.offset, 10) >= 0
      ? Number.parseInt(handler.event.queryStringParameters.page.offset, 10)
      : 0

  const pages = Math.ceil(total / limit)
  const page = Math.ceil(offset / limit) + 1

  body.meta.page = {}
  body.meta.page.first = 1
  body.meta.page.prev = page > 1 ? page + 1 : null
  body.meta.page.self = page
  body.meta.page.next = page < pages ? page + 1 : null
  body.meta.page.last = pages

  body.links = {}
  body.links.self = urlPrefix + url.search

  url.searchParams.set('page[offset]', 0)
  body.links.first = urlPrefix + url.search

  url.searchParams.set('page[offset]', limit * (pages - 1))
  body.links.last = urlPrefix + url.search

  if (page > 1) {
    url.searchParams.set('page[offset]', limit * (page - 2))
    body.links.prev = urlPrefix + url.search
  }

  if (page < pages) {
    url.searchParams.set('page[offset]', limit * page)
    body.links.next = urlPrefix + url.search
  }

  return body
}

const cursorBasedPagination = handler => {
  // page[cursor]
  // TODO if requested
  return handler.response.body
}

const pagination = {
  'page-based': pageBasedPagination,
  'offset-based': offsetBasedPagination,
  'cursor-based': cursorBasedPagination
}

const response = (opts, handler) => {
  const options = Object.assign({}, defaults, opts)
  const response = options.response

  handler.response = handler.response || {
    body: {},
    headers: {}
  }

  handler.response.headers = Object.assign(
    {},
    {
      'Content-Type': 'application/vnd.api+json',
      'Content-Language': handler.event.preferredLanguage // TODO refactor out
    },
    handler.response.headers
  )

  handler.response.body = Object.assign({}, response, handler.response.body)

  // add in meta
  if (response.meta) {
    handler.response.body.meta = Object.assign(
      {},
      response.meta,
      handler.response.body.meta
    )
  }

  // catch any errors
  if (handler.error) {
    if (typeof options.logger === 'function') {
      options.logger(handler.context.awsRequestId, handler.error)
    }
    handler.response = Object.assign(
      {},
      handler.response,
      unhandledError(handler),
      httpError(handler),
      jsonschemaErrors(handler)
    )

    return
  }

  // catch any stringified bodies
  if (typeof handler.response.body === 'string') {
    handler.response.body = JSON.parse(handler.response.body)
  }

  handler.response.body = pagination[options.pagination](handler)
  handler.response.body = JSON.stringify(handler.response.body)
  return
}

module.exports = opts => ({
  before: request,
  after: response.bind(null, opts),
  onError: response.bind(null, opts)
})

# middy-jsonapi
JSONAPI middleware for middy

## Why
- format lambda response to meet the [jsonapi](http://jsonapi.org) standard

## Getting Started
```bash
npm i middy middy-jsonapi
```

### Requirements
See below for full example.

#### Accept Header
The `Accept` is required to be `application/vnd.api+json`
```
.use(
      httpContentNegotiation({
        availableMediaTypes: ['application/vnd.api+json']
      })
    )
```

#### Validation
This middleware expects `400 Bad Request` to be returned from the `validator` middleware provided from `middy/middleware` or equivalent [`ajv`](https://github.com/epoberezkin/ajv) error format.

## Features
### Request
- Parses `include`, `fields`, `sort`, `page` query parameters
- See `middy-jsonapi-filter-*` for `filter` parsing [TODO]

### Response
- Format errors to meet standard
- Supports `page-based` and `offset-based` pagination auto generate `links` from `meta.total` & `meta.count`

## Deployment

```javascript
const middy = require('middy')
const {
  cache,
  cors,
  doNotWaitForEmptyEventLoop,
  functionShield,
  httpEventNormalizer,
  httpHeaderNormalizer,
  httpContentNegotiation,
  httpSecurityHeaders,
  jsonBodyParser,
  secretsManager,
  ssm,
  urlEncodeBodyParser,
  validator,
  warmup
} = require('middy/middlewares')
const jsonapi = require('middy-jsonapi')
const authorization = require('../middleware/authorization')

const ajvOptions = {
  v5: true,
  format: 'full',
  coerceTypes: 'array',
  allErrors: true,
  useDefaults: true,
  $data: true
}

const meta = require('../../package.json')
const response = {
  jsonapi: { version:'1.0' },
  meta: {
    version: `v${meta.version}`,
    copyright: meta.copyright,
    authors: meta.authors,
    now: new Date().toISOString()
  }
}

// cache
const myStorage = {}
const getValue = key => Promise.resolve(myStorage[key])

const setValue = (key, value) => {
  myStorage[key] = value
  return Promise.resolve()
}

module.exports = (app, { inputSchema, outputSchema }) =>
  middy(app)
    .use(warmup())
    //.use(ssm({
    //   cache: true,
    //   setToContext: true
    // }))
    //.use(secretsManager({
    //  cache: true
    //}))
    .use(functionShield({
      policy: { disable_analytics: true }
    }))
    .use(doNotWaitForEmptyEventLoop())
    .use(httpEventNormalizer())
    .use(httpHeaderNormalizer())
    .use(urlEncodeBodyParser())
    .use(jsonBodyParser())
    .use(httpSecurityHeaders())
    .use(cors())
    //.use(cache())
    .use(jsonapi({ response })) // Replaces: httpErrorHandler
    .use(
      httpContentNegotiation({
        availableLanguages: ['en-CA', 'fr-CA'],
        availableMediaTypes: ['application/vnd.api+json']
      })
    )
    //.use(authorization())
    .use(validator({ inputSchema, outputSchema, ajvOptions }))
```

### Response Deserialization
We recommend [`kitsu-core`](https://github.com/wopian/kitsu) for deserializing 

```javascript
const { deserialise } = require('kitsu-core/node')

const jsonapiDeserialise = body => {
  deserialise(body)
  return body
}
```

## Built With
- [middy](https://github.com/middyjs/middy)

## Authors
- [willfarrell](https://github.com/willfarrell/)

## License
This project is licensed under the MIT License - see the LICENSE file for details

## TODO
- deserilize middleware
- json schema definitions
- Add in jsonapi ~= for httpPartialResponse

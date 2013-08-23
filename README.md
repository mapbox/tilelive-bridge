tilelive-bridge
---------------
Implements the tilelive API for generating mapnik vector tiles from traditional mapnik datasources.

[![Build Status](https://secure.travis-ci.org/mapbox/tilelive-bridge.png)](http://travis-ci.org/mapbox/tilelive-bridge)

### new Bridge(options, callback)

- *xml*: a Mapnik XML string that will be used to generate vector tiles.
- *base*: Optional, basepath for Mapnik map. Defaults to `__dirname`.
- *deflate*: Optional, whether to generate deflated vector tiles. Defaults to `true`.

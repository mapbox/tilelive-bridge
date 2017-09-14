tilelive-bridge
---------------
Implements the tilelive API for generating mapnik vector tiles from traditional mapnik datasources.

[![Build Status](https://secure.travis-ci.org/mapbox/tilelive-bridge.png)](http://travis-ci.org/mapbox/tilelive-bridge)
[![Coverage Status](https://coveralls.io/repos/mapbox/tilelive-bridge/badge.svg?branch=master&service=github)](https://coveralls.io/github/mapbox/tilelive-bridge?branch=master)
[![Build status](https://ci.appveyor.com/api/projects/status/x4i1acjnrrxdr7ax?svg=true)](https://ci.appveyor.com/project/Mapbox/tilelive-bridge)

### new Bridge(options, callback)

- *xml*: a Mapnik XML string that will be used to generate vector tiles.
- *base*: Optional, basepath for Mapnik map. Defaults to `__dirname`.

## Installation

    npm install @mapbox/tilelive-bridge

Though `tilelive` is not a dependency of `tilelive-bridge` you will want to
install it to actually make use of `tilelive-bridge` through a reasonable
API.

## Usage

```javascript
var tilelive = require('tilelive');
require('@mapbox/tilelive-bridge').registerProtocols(tilelive);

tilelive.load('bridge:///path/to/file.xml', function(err, source) {
    if (err) throw err;

    // Interface is in XYZ/Google coordinates.
    // Use `y = (1 << z) - 1 - y` to flip TMS coordinates.
    source.getTile(0, 0, 0, function(err, tile, headers) {
        // `err` is an error object when generation failed, otherwise null.
        // `tile` contains the compressed image file as a Buffer
        // `headers` is a hash with HTTP headers for the image.
    });

    // The `.getGrid` is implemented accordingly.
});
```

### Limiting tile sizes

You can set a limit to the size of vector tiles created (in bytes) by setting the `BRIDGE_MAX_VTILE_BYTES_COMPRESSED=n` environment variable. If a tile is generated and larger than the threshold, the process will return `Tile >= max allowed size` as an error.

If you'd like to get statistics about tiles above a certain byte size (before limiting with the above), you can provide the `BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED=n` environment variable in your tilelive-driven application and this will generate a stats object on you file system named `tilelive-bridge-stats.json` which includes the average tile size, the maximum tile size, and the number of tiles greater than the threshold set with the environment variable.

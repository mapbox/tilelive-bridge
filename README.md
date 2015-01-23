tilelive-bridge
---------------
Implements the tilelive API for generating mapnik vector tiles from traditional mapnik datasources.

[![Build Status](https://secure.travis-ci.org/mapbox/tilelive-bridge.png)](http://travis-ci.org/mapbox/tilelive-bridge)

### new Bridge(options, callback)

- *xml*: a Mapnik XML string that will be used to generate vector tiles.
- *base*: Optional, basepath for Mapnik map. Defaults to `__dirname`.

## Installation

    npm install tilelive-bridge

Though `tilelive` is not a dependency of `tilelive-bridge` you will want to
install it to actually make use of `tilelive-bridge` through a reasonable
API.

## Usage

```javascript
var tilelive = require('tilelive');
require('tilelive-bridge').registerProtocols(tilelive);

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

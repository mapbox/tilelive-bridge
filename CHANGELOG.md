# Changlog

## 2.5.1

 - Reduce mapnik dependency to include ~3.6.0 for any downstream users

## 2.5.0

 - Add option to limit tiles by size in bytes [#92](https://github.com/mapbox/tilelive-bridge/pull/92)

## 2.4.0

 - Updated to use mapnik 3.6.0
 - Switch to using @mapbox package for spherical mercator

## 2.3.1

 - Add try/catch around mapnik.VectorTile constructor to prevent invalid parameters from causing a throw

## 2.3.0

 - Update mapnik to `3.5.0`, with vector-tile v2 spec implementation

## 2.2.3

 - Add timeout to `.close()` as a temporary workaround to stubborn non-draining pools.

## 2.2.2

 - Fix for bug where blank mode regressed as a side-effect of new painted handling.

## 2.2.1

 - Upgraded to mapnik-pool@0.1.2 (with an upgrade to generic-pool@2.2.1)
   - A hang was encountered with older `generic-pool` so this may fix hangs seen downstream.
 - Added the usage of a readonly `mapnik.Map` object for readonly operations
   - Now only `getTile` uses pooled maps. This simplifies the code and also should allow
     `getInfo` and `getIndexableDocs` to perform better because they no longer need to
     pull maps from the pool.
   - Now an invalid XML will throw at source creation rather than at source usage. This should
     avoid programming errors downstream.
 - Now pooling images to reduce allocation overhead. This radically reduces memory needs when
   rendering raster tiles.
 - Improved tests to avoid potential hangs at exit due to unclosed sources

## 2.2.0

 - Render VTs with strictly_simple flag.

## 2.1.0

 - Reduce default simplify_distance to 4 targeting GL rendering.

## 2.0.0

 - Update to new carmen geocoder indexing API.

## 1.6.0

 - Return a header that will notify tilelive if vector data is painted.

## 1.5.1

 - Removed bad checked if image is painted to determine if it is empty or not as this
   results in empty tiles being created.

## 1.5.0

 - Update to mapnik 3.4.6

## 1.4.0

 - Update to mapnik 3.4.x.

## 1.3.0

 - Update to mapnik 3.3.x with improved VT simplification.

## 1.2.6

 - Drain the mapnik-pool before destroying it during .close()

## 1.2.5

 - Rollback getIndexableDocs limit change

## 1.2.4

 - Fix bug with getIndexableDocs bbox generation

## 1.2.3

 - Double tap interpolation (missed parity flag)

## 1.2.2

 - Handle interpolation keys when indexing carmen docs

## 1.2.1

 - Fix for edgecase bug in pixel_key generation
 - Remove check for xml differences before updating map

## 1.2.0

 - Update to node-mapnik@3.1.0
 - Automatically reproject data to WGS84 in geIndexableDocs

## 1.1.0

 - More efficient featureset iteration in getIndexableDocs from @manubb
 - Drop tolerance for vector tile encoding to 8 to better support GL rendering

## 1.0.0

 - Update to node-mapnik@3.0.0, requires C++11 support.

## 0.6.0

 - Non-optional gzip compression for output VTs

## 0.5.0

 - Add basic handling for raster sources

## 0.4.0

 - Adjust tolerance from sliding scale to constant 32 until maxzoom is reached

## 0.3.0

 - Loosen node-mapnik semver to any ~1.4.0 version
 - Drop eio in favor of node 0.10+ UV_THREADPOOL_SIZE

## 0.2.0

 - Update to node-mapnik 1.4.x binaries! \o/

## 0.1.0

 - Update to node-mapnik 1.3.x series.

## 0.0.6

 - Adds support for carmen (dev) getIndexableDocs method.
 - Fixes tile solid handling.

## 0.0.5

 - Flipped default handling of solid tiles from blank: true to blank: false.

## 0.0.4

 - Fix handling of buffer to work with node-mapnik v1.2.x changes (#5)

## 0.0.3

 - Bumped node-mapnik dep to v1.2.x
 - Added LICENSE
 - Added travis support

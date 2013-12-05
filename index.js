var url = require('url');
var path = require('path');
var zlib = require('zlib');
var crypto = require('crypto');
var mapnik = require('mapnik');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var qs = require('querystring');
var sm = new (require('sphericalmercator'));

if (process.platform !== 'win32') {
    var major_version = parseInt(process.versions.node.split('.')[0],10);
    var minor_version = parseInt(process.versions.node.split('.')[1],10);
    // older node versions support eio, newer need UV_THREADPOOL_SIZE set
    if (major_version == 0 && minor_version < 9) {
        // Increase number of threads to 1.5x the number of logical CPUs.
        var threads = Math.ceil(Math.max(4, require('os').cpus().length * 1.5));
        require('eio').setMinParallel(threads);
    }
}

module.exports = Bridge;

function Bridge(uri, callback) {
    if (typeof uri === 'string' || (uri.protocol && !uri.xml)) {
        uri = typeof uri === 'string' ? url.parse(uri) : uri;
        uri.query = typeof uri.query === 'string' ? qs.parse(uri.query) : (uri.query || {});
        var filepath = path.resolve(uri.pathname);
        return fs.readFile(filepath, 'utf8', function(err, xml) {
            if (err) return callback(err);
            var opts = Object.keys(uri.query).reduce(function(memo, key) {
                memo[key] = !!parseInt(uri.query[key], 10);
                return memo;
            }, {xml:xml, base:path.dirname(filepath)});
            return new Bridge(opts, callback);
        });
    }

    if (!uri.xml) return callback && callback(new Error('No xml'));

    this._uri = uri;
    this._deflate = typeof uri.deflate === 'boolean' ? uri.deflate : true;
    this._base = path.resolve(uri.base || __dirname);

    // 'blank' option forces all solid tiles to be interpreted as blank.
    this._blank = typeof uri.blank === 'boolean' ? uri.blank : false;

    if (callback) this.once('open', callback);

    this.update(uri, function(err) {
        this.emit('open', err, this);
    }.bind(this));
};
require('util').inherits(Bridge, require('events').EventEmitter);

Bridge.registerProtocols = function(tilelive) {
    tilelive.protocols['bridge:'] = Bridge;
};

// Helper for callers to ensure source is open. This is not built directly
// into the constructor because there is no good auto cache-keying system
// for these tile sources (ie. sharing/caching is best left to the caller).
Bridge.prototype.open = function(callback) {
    if (this._map) return callback(null, this);
    this.once('open', callback);
};

// Allows in-place update of XML/backends.
Bridge.prototype.update = function(opts, callback) {
    // If the XML has changed update the map.
    if (opts.xml && this._xml !== opts.xml) {
        this._xml = opts.xml;
        this._map = this._map || Pool({
            create: function(callback) {
                var map = new mapnik.Map(256, 256);
                map.fromString(this._xml, {
                    strict:false,
                    base:this._base + '/'
                }, function(err) {
                    if (err) return callback(err);
                    map.bufferSize = 256;
                    return callback(err, map);
                });
            }.bind(this),
            destroy: function(map) { delete map; },
            max: require('os').cpus().length
        });
        // If no nextTick the stale pool can be used to acquire new maps.
        return process.nextTick(function() {
            this._map.destroyAllNow(callback);
        }.bind(this));
    }
    return callback();
};

Bridge.prototype.close = function(callback) {
    if (!this._map) return callback();
    this._map.destroyAllNow(callback);
};

Bridge.prototype.getTile = function(z, x, y, callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));

    var source = this;
    source._map.acquire(function(err, map) {
        if (err) return callback(err);

        var opts = {};
        // higher value more coordinates will be skipped
        opts.tolerance = Math.max(0, Math.min(5, 14-z));
        // make larger than zero to enable
        opts.simplify = 0;
        // 'radial-distance', 'visvalingam-whyatt', 'zhao-saalfeld' (default)
        opts.simplify_algorithm = 'radial-distance'

        var headers = {};
        headers['Content-Type'] = 'application/x-protobuf';
        if (source._deflate) headers['Content-Encoding'] = 'deflate';

        map.resize(256, 256);
        map.extent = sm.bbox(+x,+y,+z, false, '900913');
        // also pass buffer_size in options to be forward compatible with recent node-mapnik
        // https://github.com/mapnik/node-mapnik/issues/175
        opts.buffer_size = map.bufferSize;
        map.render(new mapnik.VectorTile(+z,+x,+y), opts, function(err, image) {
            process.nextTick(function() { source._map.release(map); });

            if (err) return callback(err);
            // Fake empty RGBA to the rest of the tilelive API for now.
            image.isSolid(function(err, solid, key) {
                if (err) return callback(err);
                // Solid handling.
                var done = function(err, buffer) {
                    if (err) return callback(err);
                    if (solid === false) return callback(err, buffer, headers);
                    // Empty tiles are equivalent to no tile.
                    if (source._blank || !key) return callback(new Error('Tile does not exist'));
                    // Fake a hex code by md5ing the key.
                    var mockrgb = crypto.createHash('md5').update(buffer).digest('hex').substr(0,6);
                    buffer.solid = [
                        parseInt(mockrgb.substr(0,2),16),
                        parseInt(mockrgb.substr(2,2),16),
                        parseInt(mockrgb.substr(4,2),16),
                        1
                    ].join(',');
                    return callback(err, buffer, headers);
                };
                // No deflate.
                return !source._deflate
                    ? done(null, image.getData())
                    : zlib.deflate(image.getData(), done);
            });
        });
    });
};

Bridge.prototype.getInfo = function(callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));

    this._map.acquire(function(err, map) {
        if (err) return callback(err);

        var params = map.parameters;
        var info = Object.keys(params).reduce(function(memo, key) {
            switch (key) {
            // The special "json" key/value pair allows JSON to be serialized
            // and merged into the metadata of a mapnik XML based source. This
            // enables nested properties and non-string datatypes to be
            // captured by mapnik XML.
            case 'json':
                try { var jsondata = JSON.parse(params[key]); }
                catch (err) { return callback(err); }
                Object.keys(jsondata).reduce(function(memo, key) {
                    memo[key] = memo[key] || jsondata[key];
                    return memo;
                }, memo);
                break;
            case 'bounds':
            case 'center':
                memo[key] = params[key].split(',').map(function(v) { return parseFloat(v) });
                break;
            case 'minzoom':
            case 'maxzoom':
                memo[key] = parseInt(params[key], 10);
                break;
            default:
                memo[key] = params[key];
                break;
            }
            return memo;
        }, {});

        process.nextTick(function() { this._map.release(map); }.bind(this));
        return callback(null, info);
    }.bind(this));
};

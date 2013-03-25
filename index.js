var url = require('url');
var path = require('path');
var zlib = require('zlib');
var mapnik = require('mapnik');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var sm = new (require('sphericalmercator'));

// Increase number of threads to 1.5x the number of logical CPUs.
var threads = Math.ceil(Math.max(4, require('os').cpus().length * 1.5));
require('eio').setMinParallel(threads);

module.exports = Bridge;

function Bridge(uri, callback) {
    if (typeof uri === 'string' || (uri.protocol && !uri.xml)) {
        uri = typeof uri === 'string' ? url.parse(uri, true) : uri;
        var filepath = path.resolve(uri.pathname);
        return fs.readFile(filepath, 'utf8', function(err, xml) {
            if (err) return callback(err);
            return new Bridge({ xml: xml, base: path.dirname(filepath) }, callback);
        });
    }

    if (!uri.xml) return callback && callback(new Error('No xml'));

    this._uri = uri;
    this._deflate = typeof uri.deflate === 'boolean' ? uri.deflate : true;
    this._base = path.resolve(uri.base || __dirname);
    this._solidCache = {};

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
        map.render(new mapnik.DataTile(+z,+x,+y), opts, function(err, image) {
            process.nextTick(function() { source._map.release(map); });

            if (err) return callback(err);
            // Fake empty RGBA to the rest of the tilelive API for now.
            image.isSolid(function(err, solid, key) {
                // Cache hit.
                if (solid && source._solidCache[key]) {
                    return callback(null, source._solidCache[key], headers);
                }
                // No deflate.
                if (!source._deflate) {
                    var buffer = image.getData();
                    if (solid !== false) {
                        buffer.solid = solid && '0,0,0,0';
                        source._solidCache[key] = buffer;
                    }
                    return callback(err, buffer, headers);
                }
                // With deflate.
                return zlib.deflate(image.getData(), function(err, buffer) {
                    if (err) return callback(err);
                    if (solid !== false) {
                        buffer.solid = solid && '0,0,0,0';
                        source._solidCache[key] = buffer;
                    }
                    return callback(err, buffer, headers);
                });
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

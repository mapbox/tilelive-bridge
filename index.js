var url = require('url');
var path = require('path');
var zlib = require('zlib');
var crypto = require('crypto');
var mapnik = require('mapnik');
var Pool = require('generic-pool').Pool;
var fs = require('fs');
var qs = require('querystring');
var sm = new (require('sphericalmercator'));
var immediate = global.setImmediate || process.nextTick;

// Register datasource plugins
mapnik.register_default_input_plugins()

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
    var source = this;

    if (typeof uri === 'string' || (uri.protocol && !uri.xml)) {
        uri = typeof uri === 'string' ? url.parse(uri) : uri;
        uri.query = typeof uri.query === 'string' ? qs.parse(uri.query) : (uri.query || {});
        var filepath = path.resolve(uri.pathname);
        fs.readFile(filepath, 'utf8', function(err, xml) {
            if (err) return callback(err);
            var opts = Object.keys(uri.query).reduce(function(memo, key) {
                memo[key] = !!parseInt(uri.query[key], 10);
                return memo;
            }, {xml:xml, base:path.dirname(filepath)});
            init(opts);
        });
        return source;
    } else {
        init(uri);
        return source;
    }

    function init(uri) {
        if (!uri.xml) return callback && callback(new Error('No xml'));

        source._uri = uri;
        source._deflate = typeof uri.deflate === 'boolean' ? uri.deflate : true;
        source._base = path.resolve(uri.base || __dirname);

        // 'blank' option forces all solid tiles to be interpreted as blank.
        source._blank = typeof uri.blank === 'boolean' ? uri.blank : false;

        if (callback) source.once('open', callback);

        source.update(uri, function(err) {
            source.emit('open', err, source);
        });
    };
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
        return immediate(function() {
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
            immediate(function() { source._map.release(map); });

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
            case 'geocoder_shardlevel':
            case 'geocoder_resolution':
                memo[key] = parseInt(params[key], 10);
                break;
            default:
                memo[key] = params[key];
                break;
            }
            return memo;
        }, {});

        // Set an intelligent default for geocoder_shardlevel if not set.
        if (info.geocoder_layer && !('geocoder_shardlevel' in info)) {
            if (info.maxzoom > 12) {
                info.geocoder_shardlevel = 3;
            } else if (info.maxzoom > 8) {
                info.geocoder_shardlevel = 2;
            } else if (info.maxzoom > 6) {
                info.geocoder_shardlevel = 1;
            } else {
                info.geocoder_shardlevel = 0;
            }
        }

        immediate(function() { this._map.release(map); }.bind(this));
        return callback(null, info);
    }.bind(this));
};

Bridge.prototype.getIndexableDocs = function(pointer, callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));

    pointer = pointer || {};
    pointer.limit = pointer.limit || 10000;
    pointer.offset = pointer.offset || 0;

    var source = this;
    var knownsrs = {
        '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over': '900913',
        '+proj=merc +lon_0=0 +lat_ts=0 +x_0=0 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs': '900913',
        '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs': 'WGS84'
    };

    source.getInfo(function(err, info) {
        if (err) return callback(err);
        source._map.acquire(function(err, map) {
            if (err) return callback(err);
            immediate(function() { source._map.release(map) });

            var name = (map.parameters.geocoder_layer||'').split('.').shift() || '';
            var field = (map.parameters.geocoder_layer||'').split('.').pop() || '_text';
            var zoom = info.maxzoom + parseInt(map.parameters.geocoder_resolution||0, 10);
            var layer = name
                ? map.layers().filter(function(l) { return l.name === name })[0]
                : map.layers()[0];

            if (!zoom) return callback(new Error('No geocoding zoom defined'));
            if (!layer) return callback(new Error('No geocoding layer found'));
            if (!knownsrs[layer.srs]) return callback(new Error('Unknown layer SRS'));

            var srs = knownsrs[layer.srs];
            var featureset = layer.datasource.featureset();
            var params = layer.datasource.parameters();
            var docs = [];
            var cache = {};
            var i = 0;

            function feature() {
                if (i === pointer.offset + pointer.limit) {
                    pointer.offset = pointer.offset + pointer.limit;
                    return callback(null, docs, pointer);
                }

                var f = featureset.next();
                if (!f) {
                    pointer.offset = i;
                    return callback(null, docs, pointer);
                }

                // Skip over features if not yet paged to offset.
                if (i < pointer.offset) return ++i && immediate(function() {
                    feature();
                });

                var doc = f.attributes();
                if (!doc[field]) return ++i && immediate(function() {
                    feature();
                });
                doc._id = f.id();
                doc._zxy = [];
                doc._text = doc[field];
                if (typeof doc._bbox === 'string') {
                    doc._bbox = doc._bbox.split(',');
                    doc._bbox[0] = parseFloat(doc._bbox[0]);
                    doc._bbox[1] = parseFloat(doc._bbox[1]);
                    doc._bbox[2] = parseFloat(doc._bbox[2]);
                    doc._bbox[3] = parseFloat(doc._bbox[3]);
                } else {
                    doc._bbox = doc._bbox || (srs === 'WGS84' ? f.extent() : sm.convert(f.extent(), 'WGS84'));
                }
                if (typeof doc._center === 'string') {
                    doc._center = doc._center.split(',');
                    doc._center[0] = parseFloat(doc._center[0]);
                    doc._center[1] = parseFloat(doc._center[1]);
                } else {
                    doc._center = [
                        doc._bbox[0] + (doc._bbox[2]-doc._bbox[0])*0.5,
                        doc._bbox[1] + (doc._bbox[3]-doc._bbox[1])*0.5
                    ];
                }
                if (doc._bbox[0] === doc._bbox[2]) delete doc._bbox;
                docs.push(doc);
                var t = sm.xyz(f.extent(), zoom, false, srs);
                var x = t.minX;
                var y = t.minY;
                var c = (t.maxX - t.minX + 1) * (t.maxY - t.minY + 1);
                function tiles() {
                    if (x > t.maxX && y > t.maxY) return ++i && immediate(function() {
                        feature();
                    });
                    if (y > t.maxY && ++x) y = t.minY;
                    var key = zoom + '/' + x + '/' + y;

                    // Features must cover > 2 tiles to have false positives.
                    if (c < 3 || cache[key]) {
                        if (c < 3 || cache[key][doc._id]) doc._zxy.push(key);
                        y++;
                        return tiles();
                    }

                    cache[key] = {};
                    map.extent = sm.bbox(x,y,zoom,false,'900913');
                    map.render(new mapnik.VectorTile(zoom,x,y), {}, function(err, vtile) {
                        if (err) return callback(err);
                        var json = vtile.toJSON();
                        json.forEach(function(l) {
                            if (l.name !== layer.name) return;
                            for (var i = 0; i < l.features.length; i++) cache[key][l.features[i].id] = true;
                        });
                        immediate(function() { tiles() });
                    });
                }
                tiles();
            }
            feature();
        });
    });
};


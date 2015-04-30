var url = require('url');
var path = require('path');
var zlib = require('zlib');
var mapnik = require('mapnik');
var fs = require('fs');
var qs = require('querystring');
var sm = new (require('sphericalmercator'))();
var immediate = global.setImmediate || process.nextTick;

// Register datasource plugins
mapnik.register_default_input_plugins();

var mapnikPool = require('mapnik-pool')(mapnik);

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
        source._base = path.resolve(uri.base || __dirname);

        // 'blank' option forces all solid tiles to be interpreted as blank.
        source._blank = typeof uri.blank === 'boolean' ? uri.blank : false;

        if (callback) source.once('open', callback);

        source.update(uri, function(err) {
            source.emit('open', err, source);
        });
    }
}
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
    // Unset maxzoom. Will be re-set on first getTile.
    this._maxzoom = undefined;
    // Unset type. Will be re-set on first getTile.
    this._type = undefined;
    this._xml = opts.xml;
    this._map = mapnikPool.fromString(this._xml,
        { size: 256, bufferSize: 256 },
        { strict: false, base: this._base + '/' });
    // If no nextTick the stale pool can be used to acquire new maps.
    return immediate(function() {
        this._map.destroyAllNow(callback);
    }.bind(this));
};

Bridge.prototype.close = function(callback) {
    var _map = this._map;

    if (!_map) return callback();

    _map.drain(function() {
        _map.destroyAllNow(callback);
    });

};

Bridge.prototype.getTile = function(z, x, y, callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));

    var source = this;
    source._map.acquire(function(err, map) {
        if (err) return callback(err);

        // set source _maxzoom cache to prevent repeat calls to map.parameters
        if (source._maxzoom === undefined) {
            source._maxzoom = map.parameters.maxzoom ? parseInt(map.parameters.maxzoom, 10) : 14;
        }

        // set source _type cache to prevent repeat calls to map layers
        if (source._type === undefined) {
            var layers = map.layers();
            if (layers.length && layers.some(function(l) { return l.datasource.type === 'raster' })) {
                source._type = 'raster';
            } else {
                source._type = 'vector';
            }
        }

        if (source._type === 'raster') {
            Bridge.getRaster(source, map, z, x, y, callback);
        } else {
            Bridge.getVector(source, map, z, x, y, callback);
        }
    });
};

Bridge.getRaster = function(source, map, z, x, y, callback) {
    map.resize(512,512);
    map.extent = sm.bbox(+x,+y,+z, false, '900913');
    map.render(new mapnik.Image(512,512), function(err, image) {
        immediate(function() { source._map.release(map); });
        if (err) return callback(err);
        var view = image.view(0,0,512,512);
        view.isSolid(function(err, solid, pixel) {
            if (err) return callback(err);

            // If source is in blank mode any solid tile is empty.
            if (solid && source._blank) return callback(new Error('Tile does not exist'));

            var pixel_key = '';
            if (solid) {
                var a = (pixel>>>24) & 0xff;
                var r = pixel & 0xff;
                var g = (pixel>>>8) & 0xff;
                var b = (pixel>>>16) & 0xff;
                pixel_key = r +','+ g + ',' + b + ',' + a;
            }

            view.encode('webp', {}, function(err, buffer) {
                if (err) return callback(err);
                buffer.solid = pixel_key;
                return callback(err, buffer, {'Content-Type':'image/webp'});
            });
        });
    });
};

Bridge.getVector = function(source, map, z, x, y, callback) {
    var opts = {};

    var headers = {};
    headers['Content-Type'] = 'application/x-protobuf';

    map.resize(256, 256);
    map.extent = sm.bbox(+x,+y,+z, false, '900913');

    /*
        Simplification works to generalize geometries before encoding into vector tiles.

        The 'simplify_distance' value works in integer space over a 4096 pixel grid and uses
        the Douglas–Peucker algorithm.

        The 4096 results from the path_multiplier used to maintain precision (default of 16)
        and tile width (default of 256)

        A simplify_distance of <= 0 disables the DP simplification in mapnik-vector-tile, however
        be aware that geometries will still end up being generalized based on conversion to integers during encoding.

        The greater the value the higher the level of generalization.

        The goal is to simplify enough to reduce the encoded geometry size without noticeable visual impact.

        A value of 8 is used below maxzoom. This was chosen arbitrarily.

        A value of 1 is used at maxzoom and above. The idea is that 1 will throw out nearly coincident points while
        having negligible visual impact even if the tile is overzoomed (but this warrants more testing).
    */
    opts.simplify_distance = z < source._maxzoom ? 8 : 1;
    // This is the default path_multiplier - it is not recommended to change this
    opts.path_multiplier = 16;

    // also pass buffer_size in options to be forward compatible with recent node-mapnik
    // https://github.com/mapnik/node-mapnik/issues/175
    opts.buffer_size = map.bufferSize;
    map.render(new mapnik.VectorTile(+z,+x,+y), opts, function(err, image) {
        immediate(function() { source._map.release(map); });
        if (err) return callback(err);
        image.isSolid(function(err, solid, key) {
            if (err) return callback(err);

            var buffer = image.getData();
            // we no longer need the vtile data, so purge it now
            // to keep memory low and trigger less gc churn
            image.clear(function(err) {
                zlib.gzip(buffer, function(err, pbfz) {
                    if (err) return callback(err);

                    headers['Content-Encoding'] = 'gzip';

                    // Solid handling.
                    if (solid === false) return callback(err, pbfz, headers);

                    // Empty tiles are equivalent to no tile.
                    if (source._blank || !key) return callback(new Error('Tile does not exist'));

                    pbfz.solid = key;

                    return callback(err, pbfz, headers);
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
            // The special "json" key/value pair allows JSON to be serialized
            // and merged into the metadata of a mapnik XML based source. This
            // enables nested properties and non-string datatypes to be
            // captured by mapnik XML.
            case 'json':
                try {
                    var jsondata = JSON.parse(params[key]);
                    Object.keys(jsondata).reduce(function(memo, key) {
                        memo[key] = memo[key] || jsondata[key];
                        return memo;
                    }, memo);
                }
                catch (err) { return callback(err); }
                break;
            case 'bounds':
            case 'center':
                memo[key] = params[key].split(',').map(function(v) { return parseFloat(v) });
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

    var source = this;
    var knownsrs = {
        '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over': '+init=epsg:3857',
        '+proj=merc +lon_0=0 +lat_ts=0 +x_0=0 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs': '+init=epsg:3857',
        '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs': '+init=epsg:4326'
    };

    source.getInfo(function(err, info) {
        if (err) return callback(err);
        source._map.acquire(function(err, map) {
            if (err) return callback(err);
            immediate(function() { source._map.release(map); });

            var name = (map.parameters.geocoder_layer||'').split('.').shift() || '';
            var field = (map.parameters.geocoder_layer||'').split('.').pop() || '_text';
            var zoom = info.maxzoom + parseInt(map.parameters.geocoder_resolution||0, 10);
            var layer = name ?
                map.layers().filter(function(l) { return l.name === name })[0] :
                map.layers()[0];

            if (!zoom) return callback(new Error('No geocoding zoom defined'));
            if (!layer) return callback(new Error('No geocoding layer found'));
            if (!knownsrs[layer.srs]) return callback(new Error('Unknown layer SRS'));

            var srs = knownsrs[layer.srs];
            if (!pointer.featureset) pointer.featureset = layer.datasource.featureset();
            var featureset = pointer.featureset;
            var params = layer.datasource.parameters();
            var docs = [];
            var cache = {};
            var i = 0;

            function feature() {
                if (i === pointer.limit) {
                    return callback(null, docs, pointer);
                }

                var f = featureset.next();

                if (!f) {
                    return callback(null, docs, pointer);
                }

                var doc = f.attributes();
                if (!doc[field]) return ++i && immediate(feature);
                doc._id = f.id();
                doc._text = doc[field];
                if (typeof doc._bbox === 'string') {
                    doc._bbox = doc._bbox.split(',');
                    doc._bbox[0] = parseFloat(doc._bbox[0]);
                    doc._bbox[1] = parseFloat(doc._bbox[1]);
                    doc._bbox[2] = parseFloat(doc._bbox[2]);
                    doc._bbox[3] = parseFloat(doc._bbox[3]);
                } else {
                    doc._bbox = doc._bbox || (srs === '+init=epsg:4326' ? f.extent() : sm.convert(f.extent(), 'WGS84'));
                }

                if (typeof doc._lfromhn === 'string') doc._lfromhn = doc._lfromhn.split(',');
                if (typeof doc._ltohn === 'string') doc._ltohn = doc._ltohn.split(',');
                if (typeof doc._rfromhn === 'string') doc._rfromhn = doc._rfromhn.split(',');
                if (typeof doc._rtohn === 'string') doc._rtohn = doc._rtohn.split(',');
                if (typeof doc._parityr === 'string') doc._parityr = doc._parityr.split(',');
                if (typeof doc._parityl === 'string') doc._parityl = doc._parityl.split(',');

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

                var geom = f.geometry();
                if (srs == "+init=epsg:4326") {
                    geom.toJSON(function(err,json_string) {
                        doc._geometry = JSON.parse(json_string);
                        docs.push(doc);
                        i++;
                        immediate(feature);
                    });
                } else {
                    var from = new mapnik.Projection(srs);
                    var to = new mapnik.Projection("+init=epsg:4326");
                    var tr = new mapnik.ProjTransform(from,to);
                    geom.toJSON({transform:tr},function(err,json_string) {
                        doc._geometry = JSON.parse(json_string);
                        docs.push(doc);
                        i++;
                        immediate(feature);
                    });
                }
            }

            feature();
        });
    });
};

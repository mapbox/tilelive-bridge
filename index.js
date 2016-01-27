var url = require('url');
var path = require('path');
var mapnik = require('mapnik');
var fs = require('fs');
var qs = require('querystring');
var sm = new (require('sphericalmercator'))();
var immediate = global.setImmediate || process.nextTick;
var mapnik_pool = require('mapnik-pool');
var Pool = mapnik_pool.Pool;
var os = require('os');

// Register datasource plugins
mapnik.register_default_input_plugins();

var mapnikPool = mapnik_pool(mapnik);

var ImagePool = function(size) {
    return Pool({
        create: create,
        destroy: destroy,
        max: os.cpus().length * 2
    });
    function create(callback) {
        return callback(null,new mapnik.Image(size,size));
    }
    function destroy(im) {
        delete im;
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
            if (err) {
                return callback(err);
            }
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
        if (!uri.xml) {
            return callback && callback(new Error('No xml'));
        }

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
    if (this._map) {
        return callback(null, this);
    }
    this.once('open', callback);
};

// Allows in-place update of XML/backends.
Bridge.prototype.update = function(opts, callback) {
    // Unset maxzoom. Will be re-set on first getTile.
    this._maxzoom = undefined;
    // Unset type. Will be re-set on first getTile.
    this._type = undefined;
    this._xml = opts.xml;
    this._readonly_map = new mapnik.Map(1,1);
    var mopts = { strict: false, base: this._base + '/' };
    this._readonly_map.fromString(this._xml,mopts,function(err) {
        if (err) {
            return callback(err);
        }
        this.close(function() {
            this._map = mapnikPool.fromString(this._xml,
                { size: 256, bufferSize: 256 },
                mopts);
            this._im = ImagePool(512);
            return callback();
        }.bind(this));
    }.bind(this));
};

function poolDrain(pool,callback) {
    if (!pool) {
        return callback();
    }
    pool.drain(function() {
        pool.destroyAllNow(callback);
    });
}

Bridge.prototype.close = function(callback) {
    // For currently unknown reasons map objects can currently be acquired
    // without being released under certain circumstances. When this occurs
    // a source cannot be closed fully during a copy or other operation. For
    // now error out in these scenarios as a close timeout.
    setTimeout(function() {
        if (!callback) return;
        console.warn(new Error('Source resource pool drain timed out after 5s'));
        callback();
        callback = false;
    }, 5000);
    poolDrain(this._map,function() {
        poolDrain(this._im,function() {
            if (!callback) return;
            callback();
            callback = false;
        });
    }.bind(this));
};

Bridge.prototype.getTile = function(z, x, y, callback) {
    if (!this._map) return callback(new Error('Tilesource not loaded'));

    var source = this;
    source._map.acquire(function(err, map) {
        if (err) {
            return callback(err);
        }

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
            source._im.acquire(function(err, im) {
                Bridge.getRaster(source, map, im, z, x, y, function(err,buffer,headers) {
                    source._im.release(im);
                    return callback(err,buffer,headers);
                });
            });
        } else {
            Bridge.getVector(source, map, z, x, y, callback);
        }
    });
};

Bridge.getRaster = function(source, map, im, z, x, y, callback) {
    map.bufferSize = 0;
    map.resize(512,512);
    map.extent = sm.bbox(+x,+y,+z, false, '900913');
    im.clear();
    map.render(im, function(err, image) {
        source._map.release(map);
        if (err) {
            return callback(err);
        }
        image.isSolid(function(err, solid, pixel) {
            if (err) {
                return callback(err);
            }

            // If source is in blank mode any solid tile is empty.
            if (solid && source._blank) {
                return callback(new Error('Tile does not exist'));
            }

            var pixel_key = '';
            if (solid) {
                var a = (pixel>>>24) & 0xff;
                var r = pixel & 0xff;
                var g = (pixel>>>8) & 0xff;
                var b = (pixel>>>16) & 0xff;
                pixel_key = r +','+ g + ',' + b + ',' + a;
            }

            image.encode('webp', {}, function(err, buffer) {
                if (err) {
                    return callback(err);
                }
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
        the Douglas-Peucker algorithm.

        The 4096 results from the path_multiplier used to maintain precision (default of 16)
        and tile width (default of 256)

        A simplify_distance of <= 0 disables the DP simplification in mapnik-vector-tile, however
        be aware that geometries will still end up being generalized based on conversion to integers during encoding.

        The greater the value the higher the level of generalization.

        The goal is to simplify enough to reduce the encoded geometry size without noticeable visual impact.

        A value of 4 is used below maxzoom and was chosen for detail when using mapbox-gl-js (with legacy rendering, 8 does ok as well)

        A value of 1 is used at maxzoom and above. The idea is that 1 will throw out nearly coincident points while
        having negligible visual impact even if the tile is overzoomed (but this warrants more testing).
    */
    opts.simplify_distance = z < source._maxzoom ? 4 : 1;
    // This is the default path_multiplier - it is not recommended to change this
    opts.path_multiplier = 16;

    // also pass buffer_size in options to be forward compatible with recent node-mapnik
    // https://github.com/mapnik/node-mapnik/issues/175
    opts.buffer_size = map.bufferSize;

    // enable strictly_simple
    opts.strictly_simple = true;

    map.render(new mapnik.VectorTile(+z,+x,+y), opts, function(err, image) {
        source._map.release(map);
        if (err) {
            return callback(err);
        }
        // image.isSolid(function(err, solid, key) {
        //     if (err) {
        //         return callback(err);
        //     }
        image.getData({compression:'gzip'},function(err,pbfz) {
            if (err) {
                return callback(err);
            }
            headers['Content-Encoding'] = 'gzip';
            
            headers['x-tilelive-contains-data'] = image.painted();

            // Solid handling.
            // if (solid === false) {
            //     return callback(err, pbfz, headers);
            // }

            // In blank mode solid + painted tiles are treated as empty.
            if (source._blank) {
                headers['x-tilelive-contains-data'] = false;
                return callback(new Error('Tile does not exist'), null, headers);
            }

            // Empty tiles are equivalent to no tile.
            if (!key) {
                return callback(new Error('Tile does not exist'), null, headers);
            }

            pbfz.solid = key;

            return callback(err, pbfz, headers);
        });
        // });
    });
};

Bridge.prototype.getInfo = function(callback) {
    var map = this._readonly_map;
    if (!map) {
        return callback(new Error('Tilesource not loaded'));
    }

    var params = map.parameters;
    var info = Object.keys(params).reduce(function(memo, key) {
        switch (key) {
        // The special 'json' key/value pair allows JSON to be serialized
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
    return callback(null, info);
};

Bridge.prototype.getIndexableDocs = function(pointer, callback) {
    var map = this._readonly_map;
    if (!map) {
        return callback(new Error('Tilesource not loaded'));
    }

    pointer = pointer || {};
    pointer.limit = pointer.limit || 10000;

    var source = this;
    var knownsrs = {
        '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over': '+init=epsg:3857',
        '+proj=merc +lon_0=0 +lat_ts=0 +x_0=0 +y_0=0 +ellps=WGS84 +datum=WGS84 +units=m +no_defs': '+init=epsg:3857',
        '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs': '+init=epsg:4326'
    };

    source.getInfo(function(err, info) {
        if (err) {
            return callback(err);
        }
        var name = (map.parameters.geocoder_layer||'').split('.').shift() || '';
        var field = (map.parameters.geocoder_layer||'').split('.').pop() || 'carmen:text';
        var zoom = info.maxzoom + parseInt(map.parameters.geocoder_resolution||0, 10);
        var layer = name ?
            map.layers().filter(function(l) { return l.name === name })[0] :
            map.layers()[0];

        if (!zoom) {
            return callback(new Error('No geocoding zoom defined'));
        }

        if (!layer) {
            return callback(new Error('No geocoding layer found'));
        }

        if (!knownsrs[layer.srs]) {
            return callback(new Error('Unknown layer SRS'));
        }

        var srs = knownsrs[layer.srs];
        if (!pointer.featureset) {
            pointer.featureset = layer.datasource.featureset();
        }
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

            var newdoc = {
                type: 'Feature',
                properties: f.attributes()
            };
            var doc = f.attributes();

            if (!doc[field]) {
                return ++i && immediate(feature);
            }

            newdoc.id = f.id();
            newdoc.properties['carmen:text'] = doc[field];
            if (typeof doc.bbox === 'string') {
                newdoc.bbox = doc.bbox.split(',').map(parseFloat);
            } else {
                newdoc.bbox = doc.bbox || (srs === '+init=epsg:4326' ? f.extent() : sm.convert(f.extent(), 'WGS84'));
            }

            var itpFields = ['carmen:addressnumber', 'carmen:lfromhn', 'carmen:ltohn', 'carmen:rfromhn', 'carmen:rtohn', 'carmen:parityr', 'carmen:parityl'];
            for(var field_i=0;field_i<itpFields.length;field_i++)
                if (newdoc.properties[itpFields[field_i]])
                    newdoc.properties[itpFields[field_i]] = newdoc.properties[itpFields[field_i]].split(',');

            if (typeof doc['carmen:center'] === 'string') {
                newdoc.properties['carmen:center'] = doc['carmen:center'].split(',').map(parseFloat);
            }
            else {
                newdoc.properties['carmen:center'] = [
                    newdoc.bbox[0] + (newdoc.bbox[2] - newdoc.bbox[0]) * 0.5,
                    newdoc.bbox[1] + (newdoc.bbox[3] - newdoc.bbox[1]) * 0.5
                ];
            }
            if (newdoc.bbox[0] === newdoc.bbox[2]) {
                delete newdoc.bbox;
            }

            var geom = f.geometry();

            if (srs == '+init=epsg:4326') {
                geom.toJSON(function(err,json_string) {
                    newdoc.geometry = JSON.parse(json_string);
                    docs.push(newdoc);
                    i++;
                    immediate(feature);
                });
            } else {
                var from = new mapnik.Projection(srs);
                var to = new mapnik.Projection('+init=epsg:4326');
                var tr = new mapnik.ProjTransform(from,to);
                geom.toJSON({transform:tr},function(err,json_string) {
                    newdoc.geometry = JSON.parse(json_string);
                    docs.push(newdoc);
                    i++;
                    immediate(feature);
                });
            }
        }

        feature();
    });
};

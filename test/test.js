var Bridge = require('..');
var path = require('path');
var fs = require('fs');
var mapnik = require('mapnik');
var zlib = require('zlib');
var tape = require('tape');
var UPDATE = process.env.UPDATE;

// Load fixture data.
var xml = {
    a: fs.readFileSync(path.resolve(__dirname + '/test-a.xml'), 'utf8'),
    b: fs.readFileSync(path.resolve(__dirname + '/test-b.xml'), 'utf8')
};
var rasterxml = {
    a: fs.readFileSync(path.resolve(__dirname + '/raster-a.xml'), 'utf8')
};

(function() {
    tape('should fail without xml', function(assert) {
        new Bridge({}, function(err) {
            assert.equal(err.message, 'No xml');
            assert.end();
        });
    });
    tape('should load with callback', function(assert) {
        new Bridge({ xml: xml.a, base:__dirname + '/' }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            assert.end();
        });
    });
    tape('should load from filepath', function(assert) {
        new Bridge('bridge://' + path.resolve(__dirname + '/test-a.xml'), function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal(source._blank, false);
            assert.equal(source._xml, xml.a);
            assert.equal(source._base, __dirname);
            assert.end();
        });
    });
    tape('should load with listener', function(assert) {
        var source = new Bridge('bridge://' + path.resolve(__dirname + '/test-a.xml'));
        source.on('open', function(err) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal(source._blank, false);
            assert.equal(source._xml, xml.a);
            assert.equal(source._base, __dirname);
            assert.end();
        });
    });
    tape('should load query params', function(assert) {
        new Bridge('bridge://' + path.resolve(__dirname + '/test-a.xml?blank=1'), function(err, source) {
            assert.ifError(err);
            assert.equal(source._blank, true);
            assert.equal(source._xml, xml.a);
            assert.equal(source._base, __dirname);
            assert.end();
        });
    });
    tape('#open should call all listeners', function(assert) {
        var b = new Bridge({ xml: xml.a, base:__dirname + '/' });
        var remaining = 3;
        for (var i = 0, l = remaining; i < l; i++) b.open(function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            if (!--remaining) assert.end();
        });
    });
    tape('should get info', function(assert) {
        new Bridge({ xml: xml.a, base:__dirname + '/' }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            source.getInfo(function(err, info) {
                assert.ifError(err);
                assert.equal('test-a', info.name);
                assert.equal(0, info.minzoom);
                assert.equal(8, info.maxzoom);
                assert.equal(0, info.geocoder_resolution);
                assert.equal(1, info.geocoder_shardlevel);
                assert.deepEqual([0,0,2], info.center);
                assert.deepEqual([-180,-85.0511,180,85.0511], info.bounds);
                assert.deepEqual({"level2":"property"}, info.level1, 'JSON key stores deep attribute data');
                assert.deepEqual(0, info.minzoom, 'JSON key does not overwrite other params');
                assert.end();
            });
        });
    });
    tape('should update xml', function(assert) {
        new Bridge({ xml: xml.a, base:__dirname + '/' }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            source.getInfo(function(err, info) {
                assert.ifError(err);
                assert.equal('test-a', info.name);
                source.update({xml:xml.b}, function(err) {
                    assert.ifError(err);
                    source.getInfo(function(err, info) {
                        assert.ifError(err);
                        assert.equal('test-b', info.name);
                        assert.end();
                    });
                });
            });
        });
    });
})();

function show_json(filepath,vtile1,vtile2) {
    var e = filepath+'.expected.json';
    var a = filepath+'.actual.json';
    fs.writeFileSync(e,JSON.stringify(vtile1,null,2));
    fs.writeFileSync(a,JSON.stringify(vtile2,null,2));
    throw new Error('files json representations differs: \n'+e + '\n' + a + '\n');
}

function compare_vtiles(assert,filepath,vtile1,vtile2) {
    assert.equal(vtile1.width(),vtile2.width());
    assert.equal(vtile1.height(),vtile2.height());
    assert.deepEqual(vtile1.names(),vtile2.names());
    var v1 = vtile1.toJSON();
    var v2 = vtile2.toJSON();
    assert.deepEqual(vtile1.names(),vtile2.names());
    try {
      assert.deepEqual(v1,v2);
    } catch (err) {
      show_json(filepath,v1,v2);
    }
}

(function() {
    var sources = {
        a: new Bridge({ xml:xml.a, base:__dirname + '/', blank:true }),
        b: new Bridge({ xml:xml.b, base:__dirname + '/' }),
        c: new Bridge({ xml:xml.a, base:__dirname + '/', blank:false })
    };
    var tests = {
        a: ['0.0.0', '1.0.0', '1.0.1', {key:'10.0.0',empty:true}, {key:'10.765.295',empty:true}],
        b: ['0.0.0'],
        c: [{key:'10.0.0',empty:true}, {key:'10.765.295', solid:'217,222,32,1'}]
    };
    Object.keys(tests).forEach(function(source) {
        tape('setup', function(assert) {
            sources[source].open(function(err) {
                assert.ifError(err);
                assert.end();
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tests[source].forEach(function(obj) {
            var key = obj.key ? obj.key : obj;
            var z = key.split('.')[0] | 0;
            var x = key.split('.')[1] | 0;
            var y = key.split('.')[2] | 0;
            tape('should render ' + source + ' (' + key + ')', function(assert) {
                sources[source].getTile(z,x,y, function(err, buffer, headers) {
                    // Test that empty tiles are so.
                    if (obj.empty) {
                        assert.equal(err.message, 'Tile does not exist');
                        return assert.end();
                    }

                    assert.ifError(err);
                    assert.equal(headers['Content-Type'], 'application/x-protobuf');
                    assert.equal(headers['Content-Encoding'], 'gzip');

                    // Test solid key generation.
                    if (obj.solid) assert.equal(buffer.solid, obj.solid);

                    zlib.gunzip(buffer, function(err, buffer) {
                        assert.ifError(err);

                        var filepath = __dirname + '/expected/' + source + '.' + key + '.vector.pbf';
                        if (UPDATE) fs.writeFileSync(filepath, buffer);

                        var expected = fs.readFileSync(filepath);
                        var vtile1 = new mapnik.VectorTile(+z,+x,+y);
                        var vtile2 = new mapnik.VectorTile(+z,+x,+y);
                        vtile1.setData(expected);
                        vtile1.parse();
                        vtile2.setData(buffer);
                        vtile2.parse();
                        compare_vtiles(assert,filepath,vtile1,vtile2);
                        assert.equal(expected.length, buffer.length);
                        assert.deepEqual(expected, buffer);
                        assert.end();
                    });
                });
            });
        });
    });
})();

(function() {
    var sources = {
        a: new Bridge({ xml:rasterxml.a, base:__dirname + '/', blank:true })
    };
    var tests = {
        a: ['0.0.0', '1.0.0']
    };
    Object.keys(tests).forEach(function(source) {
        tape('setup', function(assert) {
            sources[source].open(function(err) {
                assert.ifError(err);
                assert.end()
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tests[source].forEach(function(obj) {
            var key = obj.key ? obj.key : obj;
            var z = key.split('.')[0] | 0;
            var x = key.split('.')[1] | 0;
            var y = key.split('.')[2] | 0;
            tape('should render ' + source + ' (' + key + ')', function(assert) {
                sources[source].getTile(z,x,y, function(err, buffer, headers) {
                    // Test that empty tiles are so.
                    if (obj.empty) {
                        assert.equal(err.message, 'Tile does not exist');
                        return assert.end();
                    }

                    assert.ifError(err);
                    assert.equal(headers['Content-Type'], 'image/webp');

                    // Test solid key generation.
                    if (obj.solid) assert.equal(buffer.solid, obj.solid);

                    var filepath = __dirname + '/expected-raster/' + source + '.' + key + '.webp';
                    if (UPDATE) fs.writeFileSync(filepath, buffer);

                    var resultImage = new mapnik.Image.fromBytesSync(buffer);
                    var expectImage = new mapnik.Image.fromBytesSync(fs.readFileSync(filepath));
                    assert.equal(expectImage.compare(resultImage),0);
                    assert.end();
                });
            });
        });
    });
})();

(function() {
    var source;
    tape('setup', function(assert) {
        new Bridge({ xml:xml.a, base:__dirname + '/', blank:true }, function(err, s) {
            if (err) return done(err);
            source = s;
            assert.end();
        });
    });
    tape('indexes', function(assert) {
        source.getIndexableDocs({ limit:10 }, function(err, docs, pointer) {
            assert.ifError(err);
            assert.deepEqual({offset:10, limit:10}, pointer);
            assert.deepEqual([
                'Antigua and Barbuda',
                'Algeria',
                'Azerbaijan',
                'Albania',
                'Armenia',
                'Angola',
                'American Samoa',
                'Argentina',
                'Australia',
                'Bahrain'
            ], docs.map(function(d) { return d.NAME }));
            assert.deepEqual({
                AREA: 44,
                FIPS: 'AC',
                ISO2: 'AG',
                ISO3: 'ATG',
                LAT: 17.078,
                LON: -61.783,
                NAME: 'Antigua and Barbuda',
                POP2005: 83039,
                REGION: 19,
                SUBREGION: 29,
                UN: 28,
                _id: 1,
                _zxy: [ '8/83/115', '8/84/115', '8/85/115' ],
                _text: 'Antigua and Barbuda',
                _bbox: [
                    -61.88722200000002,
                    17.02444100000014,
                    -61.68666800000004,
                    17.703888000000063
                ],
                _center: [ -61.78694500000003, 17.3641645000001 ]
            }, docs[0]);
            source.getIndexableDocs(pointer, function(err, docs, pointer) {
                assert.ifError(err);
                assert.deepEqual({offset:20, limit:10}, pointer);
                assert.deepEqual([
                    'Barbados',
                    'Bermuda',
                    'Bahamas',
                    'Bangladesh',
                    'Belize',
                    'Bosnia and Herzegovina',
                    'Bolivia',
                    'Burma',
                    'Benin',
                    'Solomon Islands'
                ], docs.map(function(d) { return d.NAME }));

                // Gross hack to end the endless setTimeout loop upstream in
                // mapnik-pool => generic-pool. Fix upstream!
                global.setTimeout = function() {};

                assert.end();
            });
        });
    });
})();



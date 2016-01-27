var Bridge = require('..');
var path = require('path');
var fs = require('fs');
var mapnik = require('mapnik');
var zlib = require('zlib');
var tape = require('tape');
var UPDATE = process.env.UPDATE;
var deepEqual = require('deep-equal');
var util = require('util');
var mapnik_pool = require('mapnik-pool');
var mapnikPool = mapnik_pool(mapnik);

// Load fixture data.
var xml = {
    a: fs.readFileSync(path.resolve(path.join(__dirname,'/test-a.xml')), 'utf8'),
    b: fs.readFileSync(path.resolve(path.join(__dirname,'/test-b.xml')), 'utf8'),
    itp: fs.readFileSync(path.resolve(path.join(__dirname,'/itp.xml')), 'utf8'),
    carmen_a: fs.readFileSync(path.resolve(path.join(__dirname,'/test-carmenprops-a.xml')), 'utf8')
};
var rasterxml = {
    a: fs.readFileSync(path.resolve(path.join(__dirname,'/raster-a.xml')), 'utf8'),
    b: fs.readFileSync(path.resolve(path.join(__dirname,'/raster-b.xml')), 'utf8'),
    c: fs.readFileSync(path.resolve(path.join(__dirname,'/raster-c.xml')), 'utf8')
};

(function() {
    tape('indexable doc carmen property normalization', function(assert) {
        new Bridge({ xml:xml.carmen_a.replace('{{MAXZOOM}}', 13), base:path.join(__dirname,'/'), blank:true }, function(err, s) {
            assert.ifError(err, 'created Bridge object w/o error');
            s.getIndexableDocs({ limit: 10 }, function(err, docs, pointer) {
                assert.ifError(err, 'got docs');
                assert.deepEqual(docs[0].bbox, [-10.0, -10.0, 10.0, 10.0], 'bbox is properly parsed & split');
                assert.deepEqual(docs[0].properties['carmen:center'], [-10.0, 10.0], 'carmen:center is properly parsed & split');
                assert.end();
            });
        });
    });
})();


(function() {
    [[13, 3], [9, 2], [7, 1], [6, 0]].forEach(function(maxzoomAndExpectedShardLevel) {
        tape(util.format('index setup - zoomlevel %d produces expected shardlevel %d', maxzoomAndExpectedShardLevel[0], maxzoomAndExpectedShardLevel[1]), function(assert) {
            new Bridge({ xml:xml.carmen_a.replace('{{MAXZOOM}}', maxzoomAndExpectedShardLevel[0]), base:path.join(__dirname,'/'), blank:true }, function(err, s) {
                assert.ifError(err, 'created Bridge object w/o error');
                s.getInfo(function(err, info) {
                    assert.ifError(err, 'fetched Bridge source info w/o error');
                    assert.equals(info.geocoder_shardlevel, maxzoomAndExpectedShardLevel[1], 'found expected shardlevel (based on maxzoom)');
                    assert.end();
                });
            });
        });
    });
})();


(function() {
    tape('should set protocol as we would like', function(assert) {
        var fake_tilelive = {
            protocols: {}
        };
        Bridge.registerProtocols(fake_tilelive);
        assert.equal(fake_tilelive.protocols['bridge:'],Bridge);
        assert.end();
    });
    tape('should fail without xml', function(assert) {
        new Bridge({}, function(err) {
            assert.equal(err.message, 'No xml');
            assert.end();
        });
    });
    tape('should fail with invalid xml', function(assert) {
        new Bridge({xml: 'bogus'}, function(err) {
            assert.equal(err.message, 'expected < at line 1');
            assert.end();
        });
    });
    tape('should fail with invalid xml at map.acquire', function(assert) {
        new Bridge({xml: '<Map></Map>'}, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            // manually break the map pool to deviously trigger later error
            // this should never happen in reality but allows us to
            // cover this error case nevertheless
            source._map = mapnikPool.fromString('bogus xml');
            source.getTile(0,0,0, function(err, buffer, headers) {
                assert.equal(err.message, 'expected < at line 1');
                source.close(function() {
                    assert.end();
                });
            });
        });
    });
    tape('should load with callback', function(assert) {
        new Bridge({ xml: xml.a, base:path.join(__dirname,'/') }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            source.close(function() {
                assert.end();
            })
        });
    });
    tape('should load from filepath', function(assert) {
        new Bridge('bridge://' + path.resolve(path.join(__dirname,'/test-a.xml')), function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal(source._blank, false);
            assert.equal(source._xml, xml.a);
            assert.equal(source._base, __dirname);
            source.close(function() {
                assert.end();
            })
        });
    });
    tape('should load with listener', function(assert) {
        var source = new Bridge('bridge://' + path.resolve(path.join(__dirname,'/test-a.xml')));
        source.on('open', function(err) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal(source._blank, false);
            assert.equal(source._xml, xml.a);
            assert.equal(source._base, __dirname);
            source.close(function() {
                assert.end();
            })
        });
    });
    tape('should load query params', function(assert) {
        new Bridge('bridge://' + path.resolve(path.join(__dirname,'/test-a.xml?blank=1')), function(err, source) {
            assert.ifError(err);
            assert.equal(source._blank, true);
            assert.equal(source._xml, xml.a);
            assert.equal(source._base, __dirname);
            source.close(function() {
                assert.end();
            })
        });
    });
    tape('#open should call all listeners', function(assert) {
        var b = new Bridge({ xml: xml.a, base:path.join(__dirname,'/') });
        var remaining = 3;
        for (var i = 0, l = remaining; i < l; i++) b.open(function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            if (!--remaining) {
                source.close(function() {
                    assert.end();
                })
            }
        });
    });
    tape('should get info', function(assert) {
        new Bridge({ xml: xml.a, base:path.join(__dirname,'/') }, function(err, source) {
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
                source.close(function() {
                    assert.end();
                })
            });
        });
    });
    tape('should update xml', function(assert) {
        new Bridge({ xml: xml.a, base:path.join(__dirname,'/') }, function(err, source) {
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
                        source.close(function() {
                            assert.end();
                        })
                    });
                });
            });
        });
    });
})();

function compare_vtiles(assert,filepath,vtile1,vtile2) {
    assert.equal(vtile1.tileSize,vtile2.tileSize);
    // assert.equal(vtile1.height(),vtile2.height());
    assert.deepEqual(vtile1.names(),vtile2.names());
    assert.deepEqual(vtile1.names(),vtile2.names());
    // assert.equal(vtile1.isSolid(),vtile2.isSolid());
    assert.equal(vtile1.empty(),vtile2.empty());
    var v1 = vtile1.toJSON();
    var v2 = vtile2.toJSON();
    assert.equal(v1.length,v2.length);
    var l1 = v1[0];
    var l2 = v2[0];
    assert.equal(l1.name,l2.name);
    assert.equal(l1.version,l2.version);
    assert.equal(l1.extent,l2.extent);
    assert.equal(l1.features.length,l2.features.length);
    assert.deepEqual(l1.features[0],l2.features[0]);
    if (!deepEqual(v1,v2)) {
        var e = filepath+'.expected.json';
        var a = filepath+'.actual.json';
        fs.writeFileSync(e,JSON.stringify(JSON.parse(vtile1.toGeoJSON('__all__')),null,2));
        fs.writeFileSync(a,JSON.stringify(JSON.parse(vtile2.toGeoJSON('__all__')),null,2));
        assert.ok(false,'files json representations differs: \n'+e + '\n' + a + '\n');
    }
}

(function() {
    var sources = {
        a: new Bridge({ xml:xml.a, base:path.join(__dirname,'/'), blank:true }),
        b: new Bridge({ xml:xml.b, base:path.join(__dirname,'/') }),
        c: new Bridge({ xml:xml.a, base:path.join(__dirname,'/'), blank:false })
    };
    var tests = {
        a: ['0.0.0', '1.0.0', '1.0.1', {key:'10.0.0',empty:true}, {key:'10.765.295',empty:true}],
        b: ['0.0.0'],
        c: [{key:'10.0.0',empty:true}, {key:'10.765.295', solid:'world'}]
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
                        assert.equal(headers['x-tilelive-contains-data'], false);
                        return assert.end();
                    }

                    assert.ifError(err);
                    assert.equal(headers['Content-Type'], 'application/x-protobuf');
                    assert.equal(headers['Content-Encoding'], 'gzip');

                    // Test solid key generation.
                    if (obj.solid) assert.equal(buffer.solid, obj.solid);

                    zlib.gunzip(buffer, function(err, buffer) {
                        assert.ifError(err);

                        var filepath = path.join(__dirname,'/expected/' + source + '.' + key + '.vector.pbf');
                        if (UPDATE || !fs.existsSync(filepath)) fs.writeFileSync(filepath, buffer);

                        var expected = fs.readFileSync(filepath);
                        var vtile1 = new mapnik.VectorTile(+z,+x,+y);
                        var vtile2 = new mapnik.VectorTile(+z,+x,+y);
                        vtile1.setDataSync(expected);
                        vtile2.setDataSync(buffer);
                        compare_vtiles(assert,filepath,vtile1,vtile2);
                        assert.equal(expected.length, buffer.length);
                        assert.deepEqual(expected, buffer);
                        assert.end();
                    });
                });
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tape('teardown', function(assert) {
            var s = sources[source];
            assert.equal(1,s._map.getPoolSize());
            assert.equal(0,s._im.getPoolSize());
            s.close(function() {
                assert.equal(0,s._map.getPoolSize());
                assert.equal(0,s._im.getPoolSize());
                assert.end();
            });
        });
    });
})();

(function() {
    var sources = {
        a: new Bridge({ xml:rasterxml.a, base:path.join(__dirname,'/'), blank:true }),
        b: new Bridge({ xml:rasterxml.b, base:path.join(__dirname,'/'), blank:true }),
        c: new Bridge({ xml:rasterxml.c, base:path.join(__dirname,'/'), blank:false })
    };
    var tests = {
        a: ['0.0.0', '1.0.0', '2.1.1', '3.2.2', '4.3.3', '5.4.4'],
        b: ['0.0.0', '1.0.0'],
        c: ['0.0.0', '1.0.0']
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
                    assert.equal(headers['Content-Type'], 'image/webp');

                    // Test solid key generation.
                    if (obj.solid) assert.equal(buffer.solid, obj.solid);

                    var filepath = path.join(__dirname,'/expected-raster/' + source + '.' + key + '.webp');
                    if (UPDATE || !fs.existsSync(filepath)) {
                        console.log('Generating image at ' + filepath);
                        fs.writeFileSync(filepath, buffer);
                    }

                    var resultImage = new mapnik.Image.fromBytesSync(buffer);
                    var expectImage = new mapnik.Image.fromBytesSync(fs.readFileSync(filepath));
                    assert.equal(expectImage.compare(resultImage),0);
                    assert.end();
                });
            });
        });
    });
    Object.keys(tests).forEach(function(source) {
        tape('teardown', function(assert) {
            var s = sources[source];
            assert.equal(1,s._map.getPoolSize());
            assert.equal(1,s._im.getPoolSize());
            s.close(function() {
                assert.equal(0,s._map.getPoolSize());
                assert.equal(0,s._im.getPoolSize());
                assert.end();
            });
        });
    });
})();

(function() {
    var source;
    tape('index setup', function(assert) {
        new Bridge({ xml:xml.a, base:path.join(__dirname,'/'), blank:true }, function(err, s) {
            if (err) return done(err);
            source = s;
            assert.end();
        });
    });
    tape('indexes', function(assert) {
        source.getIndexableDocs({ limit:10 }, function(err, docs, pointer) {
            assert.ifError(err);
            assert.deepEqual({featureset: {}, limit:10}, pointer);
            assert.deepEqual(docs.slice(0,10).map(function(d) { return d.properties['carmen:text'] }), [
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
            ]);

            assert.equal(44, docs[0].properties.AREA);
            assert.equal('AC', docs[0].properties.FIPS);
            assert.equal('AG', docs[0].properties.ISO2);
            assert.equal('ATG', docs[0].properties.ISO3);
            assert.equal(17.078, docs[0].properties.LAT);
            assert.equal(-61.783, docs[0].properties.LON);
            assert.equal('Antigua and Barbuda', docs[0].properties.NAME);
            assert.equal(83039, docs[0].properties.POP2005);
            assert.equal(19, docs[0].properties.REGION);
            assert.equal(29, docs[0].properties.SUBREGION);
            assert.equal(28, docs[0].properties.UN);
            assert.equal(1, docs[0].id);

            var coordinates = [[[[-61.686668,17.0244410000002],[-61.7944489999999,17.1633300000001],[-61.887222,17.105274],[-61.686668,17.0244410000002]]],[[[-61.7291719999999,17.608608],[-61.873062,17.7038880000001],[-61.853058,17.5830540000001],[-61.7291719999999,17.608608]]]];
            for(var i = 0; i < docs[0].geometry.coordinates.length; i++) {
                var poly = docs[0].geometry.coordinates[i];
                for(var k = 0; k < poly.length; k++) {
                    var ring = poly[k];
                    for(var j = 0; j < ring.length; j++) {
                        var pair = ring[j];
                        var lonDiff = Math.abs(pair[0] - coordinates[i][k][j][0]);
                        var latDiff = Math.abs(pair[1] - coordinates[i][k][j][1]);
                        assert.equal(true, lonDiff < 0.0000000000001);
                        assert.equal(true, latDiff < 0.0000000000001);
                    }
                }
            }

            assert.equal('Antigua and Barbuda', docs[0].properties['carmen:text']);
            var expBBox = [
                    -61.88722200000002,
                    17.02444100000014,
                    -61.68666800000004,
                    17.703888000000063
                ];
            assert.equal(true, Math.abs(expBBox[0] - docs[0].bbox[0]) < 0.0000000000001);
            assert.equal(true, Math.abs(expBBox[1] - docs[0].bbox[1]) < 0.0000000000001);
            assert.equal(true, Math.abs(expBBox[2] - docs[0].bbox[2]) < 0.0000000000001);
            assert.equal(true, Math.abs(expBBox[3] - docs[0].bbox[3]) < 0.0000000000001);
            var expCenter = [ -61.78694500000003, 17.3641645000001 ];
            assert.equal(true, Math.abs(expCenter[0] - docs[0].properties['carmen:center'][0]) < 0.0000000000001);
            assert.equal(true, Math.abs(expCenter[1] - docs[0].properties['carmen:center'][1]) < 0.0000000000001);
            source.getIndexableDocs(pointer, function(err, docs, pointer) {
                assert.ifError(err);
                assert.deepEqual({featureset: {}, limit:10}, pointer);
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
                ], docs.map(function(d) { return d.properties.NAME }));
                assert.end();
            });
        });
    });
    tape('index teardown', function(assert) {
        source.close(function() {
            assert.end();
        });
    });
    tape('itp setup', function(assert) {
        new Bridge({ xml:xml.itp, base:path.join(__dirname,'/') }, function(err, s) {
            if (err) return done(err);
            source = s;
            assert.end();
        });
    });
    tape('itp indexes', function(assert) {
        source.getIndexableDocs({ limit:10 }, function(err, docs, pointer) {
            assert.ifError(err);
            assert.deepEqual({featureset: {}, limit:10}, pointer);
            assert.equal(docs[0].properties['carmen:text'], 'Test Street');
            assert.equal(docs[0].id, 1);
            assert.deepEqual(docs[0].bbox, [ 0, 0, 20, 20 ]);
            assert.deepEqual(docs[0].properties['carmen:center'], [ 10, 10 ]);
            assert.deepEqual(docs[0].properties['carmen:lfromhn'], ['1','101']);
            assert.deepEqual(docs[0].properties['carmen:ltohn'], ['99','199']);
            assert.deepEqual(docs[0].properties['carmen:rfromhn'], ['0','100']);
            assert.deepEqual(docs[0].properties['carmen:rtohn'], ['98','198']);
            assert.deepEqual(docs[0].properties['carmen:parityr'], ['E', 'E']);
            assert.deepEqual(docs[0].properties['carmen:parityl'], ['O', 'O']);
            assert.end();
        });
    });
    tape('itp teardown', function(assert) {
        assert.equal(0,source._map.getPoolSize());
        assert.equal(0,source._im.getPoolSize());
        source.close(function() {
            assert.equal(0,source._map.getPoolSize());
            assert.equal(0,source._im.getPoolSize());
            assert.end();
        });
    });
})();

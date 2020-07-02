'use strict'
var tape = require('tape');
var path = require('path');
var fs = require('fs');
var mapnik = require('mapnik');
var queue = require('queue-async');
var sinon = require('sinon');
var os = require('os');

tape('[sqkm-stats-vector-tile] should generate a file that has SQKM stats per zoom', function(t) {
    t.test('vector-tile', function (vectorTestCase) {
        var source;
        delete require.cache[require.resolve('..')];
        process.env.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED = 1
        var Bridge = require('..');
        if (!process.exit.isSinonProxy) {
            sinon.stub(process, 'exit');
        }
        vectorTestCase.test('setup', function(assert) {
            var opts = {
                xml: fs.readFileSync(path.resolve(path.join(__dirname,'/bench-test.xml')), 'utf8'),
                base:path.join(__dirname,'/'),
                blank:false
            };
            new Bridge(opts, function cb(error, src) {
                assert.ifErr(error, 'should not throw any errror');
                source = src;
                assert.end();
            });
        });

        vectorTestCase.test('vector-tile sqkm stats', function(assert) {
            var q = queue(1);

            function getTile(z, x, y, done) {
                source.getTile(z, x, y, function(err, buffer) {
                    if (err) {
                        done(null, buffer);
                    } else {
                        var vtile = new mapnik.VectorTile(z,x,y);
                        vtile.setData(buffer, function(err) {
                            done(null, buffer)
                        });
                    }
                });
            }

            for (var z = 0; z < 5; z++) {
                for (var x = 0; x < Math.pow(2,z); x++) {
                    for (var y = 0; y < Math.pow(2,z); y++) {
                        q.defer(getTile, z, x, y);
                    }
                }
            }

            q.awaitAll(function(error) {
                assert.ifError(error);
                source.close(function() {
                    assert.true(process.exit.isSinonProxy, 'proxy process.exit');
                    assert.end();
                    process.exit(0);
                });

            });
        });

        vectorTestCase.end();
    });

    setTimeout(function() {
        process.on('exit', function () {
            var stats = JSON.parse(fs.readFileSync(os.tmpdir() + '/tilelive-bridge-stats.json').toString());
            var expected = [
                [ 0, 508164394 ],
                [ 1, 508164394 ],
                [ 2, 508164394 ],
                [ 3, 504573863 ],
                [ 4, 489633533 ]
            ];

            var actual = Object.keys(stats).filter(function (key) {
                return +key >= 0;
            }).map(function(zoom) {
                return [+zoom, Math.round(stats[zoom])];
            });

            const hasCorrectZooms = actual.length === expected.length;
            const hasValidStats = expected.every(function(stat, index) {
                var [expectedZoom, expectedSqKmArea] = stat;
                var [actualZoom, actualSqKmArea] = actual[index];
                return (expectedSqKmArea === actualSqKmArea) && (expectedZoom === actualZoom);
            });
            hasCorrectZooms && hasValidStats
                ? console.info('tilelive-bridge-stats.json has stats for vector Tiles')
                : console.error('tilelive-bridge-stats.json missing for vector Tiles');
            delete process.env.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED;
        });
    }, 0);

    t.end();
});

'use strict'
var tape = require('tape');
var path = require('path');
var fs = require('fs');
var queue = require('queue-async');
var sinon = require('sinon');
var os = require('os');

tape('[sqkm-stats-vector-tile] should generate a file that has SQKM stats per zoom', function(t) {
    var source;
    t.test('raster-tile', function(rasterTestCase) {
        delete require.cache[require.resolve('..')];
        process.env.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED = 1
        var Bridge = require('..');
        sinon.stub(process, 'exit');
        var cpus = require('os').cpus().length;
        var q = queue(cpus);

        rasterTestCase.test('setup', function (assert) {
            new Bridge({ xml: fs.readFileSync(path.resolve(path.join(__dirname,'/raster-a.xml')), 'utf8'), base:path.join(__dirname,'/'), blank:true }, function(err,s) {
                source = s;
                assert.end();
            });
        });

        rasterTestCase.test('raster-tile sqkm stats', function (assert) {
            function getTile(z, x, y, done) {
                source.getTile(z, x, y, function(err, buffer) {
                    done(null, buffer)
                });
            }

            for (var z = 0; z < 5; z++) {
                for (var x = 0; x < Math.pow(2,z); x++) {
                    for (var y = 0; y < Math.pow(2,z); y++) {
                        q.defer(getTile, z, x, y);
                    }
                }
            }

            q.awaitAll(function (error) {
                assert.ifErr(error);
                source.close(function () {
                    assert.true(process.exit.isSinonProxy, 'proxy process.exit');
                    delete process.env.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED;
                    assert.end();
                    process.exit(0);
                });
            });

        });
        rasterTestCase.end();
    });

    setTimeout(function() {
        process.on('exit', function () {
            var stats = JSON.parse(fs.readFileSync(os.tmpdir() + '/tilelive-bridge-stats.json').toString());
            var expected = [
                [ 0, 508164394 ],
                [ 1, 508164394 ],
                [ 2, 508164394 ],
                [ 3, 508164394 ],
                [ 4, 508164394 ]
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
                ? console.info('tilelive-bridge-stats.json has correct stats for raster Tiles')
                : console.error('tilelive-bridge-stats.json has incorrect stats for raster Tiles');
            process.exit.isSinonProxy ? process.exit.restore() : '';
            delete process.env.BRIDGE_LOG_MAX_VTILE_BYTES_COMPRESSED;
        });
    }, 0);

    t.end();
});

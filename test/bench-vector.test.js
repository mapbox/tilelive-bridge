var Bridge = require('..');
var mapnik = require('mapnik');
var path = require('path');
var fs = require('fs');
var tape = require('tape');
var queue = require('queue-async');

var source_deferred;
var rate_deferred;
var rate_auto;

tape('setup deferred', function(assert) {
    new Bridge({ xml: fs.readFileSync(path.resolve(path.join(__dirname,'/bench-test.xml')), 'utf8'), base:path.join(__dirname,'/'), blank:false }, function(err,s) {
        source = s;
        assert.end();
    });
});

tape('warmup deferred', function(assert) {
    source.getTile(0, 0, 0, assert.end);
});

tape('vector bench deferred', function(assert) {
    var time = +(new Date());
    var total = 0;
    var empty = 0;
    var q = queue(1);
    for (var z = 0; z < 5; z++) {
        for (var x = 0; x < Math.pow(2,z); x++) {
            for (var y = 0; y < Math.pow(2,z); y++) {
                q.defer(getTile, z, x, y);
                total++;
            }
        }
    }
    function getTile(z, x, y, done) {
        source.getTile(z, x, y, function(err, buffer) {
            if (err) {
                assert.equal(err.message, 'Tile does not exist', z + '/' + x + '/' + y);
                empty++;
                done(null, buffer);
            } else {
                var vtile = new mapnik.VectorTile(z,x,y);
                vtile.setData(buffer, function(err) {
                    assert.ifError(err, z + '/' + x + '/' + y);
                    done(null, buffer)
                });
            }   
        });
    }
    q.awaitAll(function(err, res) {
        assert.ifError(err);
        source.close(function() {
            time = +(new Date()) - time;
            rate_deferred = total/(time/1000);
            // only assert on rate for release builds
            if (process.env.NPM_FLAGS && process.env.NPM_FLAGS.indexOf('--debug') > -1) {
                console.log("Skipping rate assertion, since we are running in debug mode");
            } else {
                assert.equal(rate_deferred > 20, true, 'render ' + total + ' tiles @ ' + rate_deferred.toFixed(1) + ' tiles/sec');
            }
            assert.equal(total, 341);
            assert.equal(empty, 73);
            assert.end();
        })
    });
});

tape('setup auto', function(assert) {
    new Bridge({ xml: fs.readFileSync(path.resolve(path.join(__dirname,'/bench-test-auto.xml')), 'utf8'), base:path.join(__dirname,'/'), blank:false }, function(err,s) {
        source = s;
        assert.end();
    });
});

tape('warmup auto', function(assert) {
    source.getTile(0, 0, 0, assert.end);
});

tape('vector bench auto', function(assert) {
    var time = +(new Date());
    var total = 0;
    var empty = 0;
    var q = queue(1);
    for (var z = 0; z < 5; z++) {
        for (var x = 0; x < Math.pow(2,z); x++) {
            for (var y = 0; y < Math.pow(2,z); y++) {
                q.defer(getTile, z, x, y);
                total++;
            }
        }
    }
    function getTile(z, x, y, done) {
        source.getTile(z, x, y, function(err, buffer) {
            if (err) {
                assert.equal(err.message, 'Tile does not exist', z + '/' + x + '/' + y);
                empty++;
                done(null, buffer);
            } else {
                var vtile = new mapnik.VectorTile(z,x,y);
                vtile.setData(buffer, function(err) {
                    assert.ifError(err, z + '/' + x + '/' + y);
                    done(null, buffer)
                });
            }   
        });
    }
    q.awaitAll(function(err, res) {
        assert.ifError(err);
        source.close(function() {
            time = +(new Date()) - time;
            rate_auto = total/(time/1000);
            // only assert on rate for release builds
            if (process.env.NPM_FLAGS && process.env.NPM_FLAGS.indexOf('--debug') > -1) {
                console.log("Skipping rate assertion, since we are running in debug mode");
            } else {
               assert.equal(rate_auto > 40, true, 'render ' + total + ' tiles @ ' + rate_auto.toFixed(1) + ' tiles/sec');
            }

            assert.equal(total, 341);
            assert.equal(empty, 73);
            assert.end();
        })
    });
});

tape('setup async', function(assert) {
    new Bridge({ xml: fs.readFileSync(path.resolve(path.join(__dirname,'/bench-test-async.xml')), 'utf8'), base:path.join(__dirname,'/'), blank:false }, function(err,s) {
        source = s;
        assert.end();
    });
});

tape('warmup async', function(assert) {
    source.getTile(0, 0, 0, assert.end);
});

tape('vector bench async', function(assert) {
    var time = +(new Date());
    var total = 0;
    var empty = 0;
    var q = queue(1);
    for (var z = 0; z < 5; z++) {
        for (var x = 0; x < Math.pow(2,z); x++) {
            for (var y = 0; y < Math.pow(2,z); y++) {
                q.defer(getTile, z, x, y);
                total++;
            }
        }
    }
    function getTile(z, x, y, done) {
        source.getTile(z, x, y, function(err, buffer) {
            if (err) {
                assert.equal(err.message, 'Tile does not exist', z + '/' + x + '/' + y);
                empty++;
                done(null, buffer);
            } else {
                var vtile = new mapnik.VectorTile(z,x,y);
                vtile.setData(buffer, function(err) {
                    assert.ifError(err, z + '/' + x + '/' + y);
                    done(null, buffer)
                });
            }   
        });
    }
    q.awaitAll(function(err, res) {
        assert.ifError(err);
        source.close(function() {
            time = +(new Date()) - time;
            rate_async = total/(time/1000);
            // only assert on rate for release builds
            if (process.env.NPM_FLAGS && process.env.NPM_FLAGS.indexOf('--debug') > -1) {
                console.log("Skipping rate assertion, since we are running in debug mode");
            } else {
                assert.equal(rate_async > 40, true, 'render ' + total + ' tiles @ ' + rate_async.toFixed(1) + ' tiles/sec');
            }

            assert.equal(total, 341);
            assert.equal(empty, 73);
            assert.end();
        })
    });
});

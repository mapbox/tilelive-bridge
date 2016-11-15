var Bridge = require('..');
var path = require('path');
var fs = require('fs');
var tape = require('tape');
var queue = require('queue-async');

var source;

tape('setup', function(assert) {
    new Bridge({ xml: fs.readFileSync(path.resolve(path.join(__dirname,'/raster-a.xml')), 'utf8'), base:path.join(__dirname,'/'), blank:true }, function(err,s) {
        source = s;
        assert.end();
    });
});

tape('warmup', function(assert) {
    source.getTile(0, 0, 0, assert.end);
});

tape('raster bench', function(assert) {
    var time = +(new Date());
    var total = 0;
    var cpus = require('os').cpus().length;
    var q = queue(cpus);
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
            assert.ifError(err, z + '/' + x + '/' + y);
            done(null, buffer)
        });
    }
    q.awaitAll(function(err, res) {
        assert.ifError(err);
        source.close(function() {
            time = +(new Date()) - time;
            var rate = total/(time/1000);
            // only assert on rate for release builds
            if (process.env.NPM_FLAGS && process.env.NPM_FLAGS.indexOf('--debug') > -1) {
                console.log("Skipping rate assertion, since we are running in debug mode");
            } else {
                assert.equal(rate > 20, true, 'render ' + total + ' tiles @ ' + rate.toFixed(1) + ' tiles/sec');
            }
            assert.end();
        })
    });
});


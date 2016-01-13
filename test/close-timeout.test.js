var Bridge = require('..');
var path = require('path');
var fs = require('fs');
var tape = require('tape');

tape('should timeout on close', function(assert) {
    var warn = console.warn;
    var xml = fs.readFileSync(path.resolve(path.join(__dirname,'/test-a.xml')), 'utf8');
    console.warn = function(err) {
        assert.equal(err.toString(), 'Error: Source resource pool drain timed out after 5s', 'warns with timeout err');
    };
    new Bridge({ xml: xml, base:path.join(__dirname,'/') }, function(err, source) {
        assert.ifError(err);
        assert.ok(source);

        var map;
        source._map.acquire(function(err, m) {
            assert.ifError(err);
            assert.ok(m, 'acquires map');
            map = m;
        });

        source.close(function(err) {
            assert.ifError(err);
            console.warn = warn;

            // release map so node process ends
            source._map.release(map);

            assert.end();
        });
    });
});


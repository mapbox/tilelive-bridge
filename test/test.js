var assert = require('assert');
var Bridge = require('..');
var path = require('path');
var fs = require('fs');

// Load fixture data.
var xml = {
    a: fs.readFileSync(path.resolve(__dirname + '/test-a.xml'), 'utf8'),
    b: fs.readFileSync(path.resolve(__dirname + '/test-b.xml'), 'utf8')
};

describe('init', function() {
    it('should fail without xml', function(done) {
        new Bridge({}, function(err) {
            assert.equal(err.message, 'No xml');
            done();
        });
    });
    it('should load with callback', function(done) {
        new Bridge({ xml: xml.a, base:__dirname + '/' }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            done();
        });
    });
    it('should load from filepath', function(done) {
        new Bridge('bridge://' + path.resolve(__dirname + '/test-a.xml'), function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            assert.equal(source._blank, true);
            assert.equal(source._deflate, true);
            assert.equal(source._xml, xml.a);
            assert.equal(source._base, __dirname);
            done();
        });
    });
    it('should load query params', function(done) {
        new Bridge('bridge://' + path.resolve(__dirname + '/test-a.xml?blank=0&deflate=0'), function(err, source) {
            assert.ifError(err);
            assert.equal(source._blank, false);
            assert.equal(source._deflate, false);
            assert.equal(source._xml, xml.a);
            assert.equal(source._base, __dirname);
            done();
        });
    });
    it('#open should call all listeners', function(done) {
        var b = new Bridge({ xml: xml.a, base:__dirname + '/' });
        var remaining = 3;
        for (var i = 0, l = remaining; i < l; i++) b.open(function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            if (!--remaining) done();
        });
    });
    it('should get info', function(done) {
        new Bridge({ xml: xml.a, base:__dirname + '/' }, function(err, source) {
            assert.ifError(err);
            assert.ok(source);
            source.getInfo(function(err, info) {
                assert.ifError(err);
                assert.equal('test-a', info.name);
                assert.equal(0, info.minzoom);
                assert.equal(8, info.maxzoom);
                assert.deepEqual([0,0,2], info.center);
                assert.deepEqual([-180,-85.0511,180,85.0511], info.bounds);
                done();
            });
        });
    });
    it('should update xml', function(done) {
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
                        done();
                    });
                });
            });
        });
    });
});

describe('tiles', function() {
    var sources = {
        a: new Bridge({ xml:xml.a, base:__dirname + '/' }),
        b: new Bridge({ xml:xml.b, base:__dirname + '/', deflate:false }),
        c: new Bridge({ xml:xml.a, base:__dirname + '/', blank:false })
    };
    var tests = {
        a: ['0.0.0', '1.0.0', '1.0.1', {key:'10.0.0',solid:'0,0,0,0'}, {key:'10.765.295',solid:'0,0,0,0'}],
        b: ['0.0.0'],
        c: [{key:'10.0.0',solid:'0,0,0,0'}, {key:'10.765.295', solid:'125,121,48,1'}]
    };
    Object.keys(tests).forEach(function(source) {
        before(function(done) { sources[source].open(done); });
    });
    Object.keys(tests).forEach(function(source) {
        tests[source].forEach(function(obj) {
            var key = obj.key ? obj.key : obj;
            var z = key.split('.')[0] | 0;
            var x = key.split('.')[1] | 0;
            var y = key.split('.')[2] | 0;
            it('should render ' + source + ' (' + key + ')', function(done) {
                sources[source].getTile(z,x,y, function(err, buffer, headers) {
                    assert.ifError(err);
                    assert.equal(headers['Content-Type'], 'application/x-protobuf');
                    assert.equal(headers['Content-Encoding'], source !== 'b' ? 'deflate' : undefined);

                    // Test solid key generation.
                    if (obj.solid) assert.equal(buffer.solid, obj.solid);

                    var filepath = __dirname + '/expected/' + source + '.' + key + '.vector.pbf';
                    var expected = fs.readFileSync(filepath);
                    assert.equal(expected.length, buffer.length);
                    assert.deepEqual(expected, buffer);
                    // fs.writeFileSync(filepath, buffer);
                    done();
                });
            });
        });
    });
});


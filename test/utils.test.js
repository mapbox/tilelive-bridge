'use strict';
var tape = require('tape');
var utils = require('../utils.js');
const { calculateTileArea } = require('../utils.js');


tape('[Utils] Tile SQKM calculation', function (t) {
    t.plan(2);
    t.test('sub-tiles should have same area as parent tile', function(assert) {
        assert.plan(1);
        var acutal = [
            [1, 0, 0],
            [1, 0, 1],
            [1, 1, 0],
            [1, 1, 1]
        ].reduce(function(total , tile) {
            return calculateTileArea(...tile) + total
        }, 0);

        var expected = calculateTileArea(0, 0, 0);
        assert.equal(acutal, expected);
    });

    t.test('should have equal total area for each zoom', function(assert) {
        assert.plan(1);

        var totalAreaByZoom = [...Array(5).keys()].map(z => {
            return [].concat(...[...Array(2 ** z).keys()].map(function (x) {
                return [...Array(2 ** z).keys()].map(function (y) {
                    return calculateTileArea(z, x, y);
                });
            })).reduce(function sumPerZoom(sumOfArea, currentArea, currentIndex, allZooms) {
                var area = sumOfArea + currentArea;
                if (currentIndex === allZooms.length - 1) {
                    return Math.round(area);
                }
                return area;
            }, 0);
        });
        // check that the total area of each zoom (for a reasonable set of zooms) is generally equal
        assert.true(totalAreaByZoom.every(function (area) {
            return area === totalAreaByZoom[0];
        }), 'should have equal area by zoom');

    });
});




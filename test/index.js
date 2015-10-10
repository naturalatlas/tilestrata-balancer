var http = require('http');
var async = require('async');
var assert = require('chai').assert;
var Balancer = require('../lib/Balancer.js');
var tilestrata = require('tilestrata');

describe('TileStrata Balancer', function() {
	it('should work normally', function(done) {
		this.timeout(5000);

		var balancer, strata;
		async.series([
			function setupBalancer(callback) {
				balancer = new Balancer({
					hostname: '127.0.0.1',
					port: '8081',
					privatePort: 8880
				});

				balancer.listen(callback);
			},
			function setupTileStrata(callback) {
				strata = tilestrata({
					balancer: {
						host: '127.0.0.1:8880',
						register_mindelay: 10,
						register_maxdelay: 10,
						register_timeout: 100
					}
				});

				strata.layer('mylayer').route('tile.txt')
					.use({
						serve: function(server, tile, callback) {
							var message = new Buffer(JSON.stringify({
								x: tile.x,
								y: tile.y,
								z: tile.z,
								layer: tile.layer,
								filename: tile.filename,
								method: tile.method,
								qs: tile.qs
							}), 'utf8');
				            callback(null, message, {'Content-Type': 'text/plain', 'X-Test': 'a'});
						}
					});

				strata.listen(8082, callback);
			},
			function waitForEstablish(callback) {
				async.whilst(
					function() { return strata.balancer.reconnecting(); },
					function(callback) {
						setTimeout(callback, 100);
					},
					callback);
			},
			function issueRequestToSucceed(callback) {
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt?someqs', function(res) {
					assert.equal(res.statusCode, 200);
					assert.equal(res.headers['x-test'], 'a');
					var body = '';
					res.setEncoding('utf8');
					res.on('data', function(chunk) { body += chunk; });
					res.on('end', function() {
						assert.deepEqual(JSON.parse(body), {"x":2,"y":1,"z":3,"layer":"mylayer","filename":"tile.txt","method":"GET","qs":"someqs"});
						callback();
					});
				}).on('error', function(err) {
					throw new Error('Request failed (' + err.message + ')');
				});
			},
			function closeTileStrata(callback) {
				strata.close(callback);
			},
			function setupUnbalancedTileStrata(callback) {
				// to make sure the host was removed from the hash ring
				strata = tilestrata();
				strata.layer('mylayer').route('tile.txt')
					.use({serve: function() { throw new Error('This should not have been called'); }});

				strata.listen(8082, callback);
			},
			function issueRequestToFail(callback) {
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt', function(res) {
					assert.equal(res.statusCode, 404);
					res.setEncoding('utf8');
					var body = '';
					res.on('data', function(chunk) { body += chunk; });
					res.on('end', function() {
						assert.equal(body, 'No servers found to handle the request');
						callback();
					});
				}).on('error', callback);
			},
			function cleanupTileStrata(callback) {
				strata.close(callback);
			},
			function cleanupTileStrataBalancer(callback) {
				balancer.close(callback);
			}
		], function(err) {
			if (err) throw err;
			done();
		});
	});
});

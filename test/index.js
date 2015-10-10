var http = require('http');
var async = require('async');
var assert = require('chai').assert;
var Balancer = require('../lib/Balancer.js');
var tilestrata = require('tilestrata');

// TODO: test metatile routing

describe('TileStrata Balancer', function() {
	var balancer, strata;
	afterEach(function(done) {
		async.series([
			function(callback) {
				if (strata) return strata.close(callback);
				callback();
			},
			function(callback) {
				if (balancer) return balancer.close(callback);
				callback();
			}
		], done);
	});

	it('should work normally', function(done) {
		this.timeout(5000);

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
			}
		], function(err) {
			if (err) throw err;
			done();
		});
	});
	it('should remove nodes removed from pool if /health check fails', function(done) {
		this.timeout(5000);
		var failAfter = 8;
		var checkInterval = 100;
		var unhealthyCount = 2;
		var healthChecks = 0;

		async.series([
			function setupBalancer(callback) {
				balancer = new Balancer({
					hostname: '127.0.0.1',
					port: '8081',
					privatePort: 8880,
					checkInterval: checkInterval,
					unhealthyCount: unhealthyCount
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
					},
					healthy: function(callback) {
						healthChecks++;

						if (healthChecks === 1) return callback();
						if (healthChecks === 2) return callback(new Error('Unhealthy'));
						if (healthChecks === 3) return callback();
						if (healthChecks === 4) return callback();
						if (healthChecks === 5) return callback(new Error('Unhealthy'));
						if (healthChecks === 6) return callback();
						if (healthChecks === 7) return callback();
						if (healthChecks === 8) return callback(new Error('Unhealthy'));
						if (healthChecks === 9) return; // time out
						throw new Error('Too many health checks');
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
			function waitForFirstFailedHealthCheck(callback) {
				var ms = checkInterval*(failAfter)+10;
				setTimeout(function() {
					assert.equal(healthChecks, failAfter, 'Check count after ' + ms + 'ms');
					callback();
				}, ms);
			},
			function issueRequestToSucceed(callback) {
				// instance should still be "healthy"
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt?someqs', function(res) {
					assert.equal(res.statusCode, 200);
					callback();
				}).on('error', function(err) {
					throw new Error('Request failed (' + err.message + ')');
				});
			},
			function waitForSecondFailedHealthCheck(callback) {
				setTimeout(callback, checkInterval*unhealthyCount+10);
			},
			function issueRequestToFail(callback) {
				http.get('http://127.0.0.1:8081/mylayer/3/2/1/tile.txt', function(res) {
					assert.equal(res.statusCode, 404);
					callback();
				}).on('error', callback);
			}
		], function(err) {
			if (err) throw err;
			done();
		});
	});
});
